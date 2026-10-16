package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

const qrTestPublicKey = "nkotje9/qlP7QjgvmpuYgD5S8J29abASkKOruu5SYDE="
const qrTestWrongKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

func newTestQRLoginHandler(t *testing.T) (*QRLoginHandler, *models.User, *models.User) {
	t.Helper()

	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	userRepo := repository.NewUserRepository(db)
	user := &models.User{
		ID:               "user-1",
		Nickname:         "Alice",
		OriginalNickname: "Alice",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderPassword,
		IsGuest:          false,
		Role:             models.RoleUser,
	}
	if err := userRepo.Create(user); err != nil {
		t.Fatalf("Create user: %v", err)
	}
	guest := &models.User{
		ID:               "guest-1",
		Nickname:         "Guest",
		OriginalNickname: "Guest",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderGuest,
		IsGuest:          true,
		Role:             models.RoleGuest,
	}
	if err := userRepo.Create(guest); err != nil {
		t.Fatalf("Create guest: %v", err)
	}

	authService := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	qrService := service.NewQRLoginService(repository.NewQRLoginRepository(db), authService)
	return NewQRLoginHandler(qrService), user, guest
}

func qrAuthedRequest(t *testing.T, method, target string, body interface{}, userID string) *http.Request {
	t.Helper()

	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}

	req := httptest.NewRequest(method, target, &buf)
	if userID != "" {
		req = req.WithContext(context.WithValue(req.Context(), "user", &models.JWTClaims{UserID: userID}))
	}
	return req
}

func TestQRCreateAndPollFlow(t *testing.T) {
	handler, user, _ := newTestQRLoginHandler(t)

	// New device creates a challenge
	createReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/challenge", models.CreateQRChallengeRequest{
		PublicKey:  qrTestPublicKey,
		DeviceName: "Chrome · Windows",
		DeviceInfo: `{"browser":"Chrome"}`,
	}, "")
	createRec := httptest.NewRecorder()
	handler.CreateChallenge(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create status = %d, want %d (body: %s)", createRec.Code, http.StatusOK, createRec.Body.String())
	}

	var created models.CreateQRChallengeResponse
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.ChallengeID == "" {
		t.Fatal("expected non-empty challenge id")
	}

	// Scanner reads the challenge metadata
	getReq := qrAuthedRequest(t, http.MethodGet, "/api/auth/qr/challenge/"+created.ChallengeID, nil, user.ID)
	getReq = mux.SetURLVars(getReq, map[string]string{"id": created.ChallengeID})
	getRec := httptest.NewRecorder()
	handler.GetChallenge(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d (body: %s)", getRec.Code, http.StatusOK, getRec.Body.String())
	}
	var view struct {
		ChallengeID string `json:"challenge_id"`
		DeviceName  string `json:"device_name"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(getRec.Body).Decode(&view); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if view.DeviceName != "Chrome · Windows" || view.Status != models.QRLoginChallengePending {
		t.Fatalf("unexpected challenge view: %+v", view)
	}

	// Polling before approval answers 202
	claimReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/claim", models.ClaimQRChallengeRequest{
		ChallengeID: created.ChallengeID,
	}, "")
	claimRec := httptest.NewRecorder()
	handler.ClaimChallenge(claimRec, claimReq)
	if claimRec.Code != http.StatusAccepted {
		t.Fatalf("claim-before-approve status = %d, want %d", claimRec.Code, http.StatusAccepted)
	}

	// Approve with a mismatched key is rejected
	badApprove := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/approve", models.ApproveQRChallengeRequest{
		ChallengeID: created.ChallengeID,
		PublicKey:   qrTestWrongKey,
	}, user.ID)
	badRec := httptest.NewRecorder()
	handler.ApproveChallenge(badRec, badApprove)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched-key approve status = %d, want %d", badRec.Code, http.StatusBadRequest)
	}

	// Approve, then claim exactly once
	approveReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/approve", models.ApproveQRChallengeRequest{
		ChallengeID: created.ChallengeID,
		PublicKey:   qrTestPublicKey,
	}, user.ID)
	approveRec := httptest.NewRecorder()
	handler.ApproveChallenge(approveRec, approveReq)
	if approveRec.Code != http.StatusOK {
		t.Fatalf("approve status = %d, want %d (body: %s)", approveRec.Code, http.StatusOK, approveRec.Body.String())
	}

	claimReq2 := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/claim", models.ClaimQRChallengeRequest{
		ChallengeID: created.ChallengeID,
	}, "")
	claimRec2 := httptest.NewRecorder()
	handler.ClaimChallenge(claimRec2, claimReq2)
	if claimRec2.Code != http.StatusOK {
		t.Fatalf("claim status = %d, want %d (body: %s)", claimRec2.Code, http.StatusOK, claimRec2.Body.String())
	}
	var claimed models.ClaimQRChallengeResponse
	if err := json.NewDecoder(claimRec2.Body).Decode(&claimed); err != nil {
		t.Fatalf("decode claim response: %v", err)
	}
	if claimed.Status != models.QRLoginChallengeApproved || claimed.SealedPayload == "" {
		t.Fatalf("unexpected claim response: %+v", claimed)
	}

	// Re-claim is rejected
	claimReq3 := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/claim", models.ClaimQRChallengeRequest{
		ChallengeID: created.ChallengeID,
	}, "")
	claimRec3 := httptest.NewRecorder()
	handler.ClaimChallenge(claimRec3, claimReq3)
	if claimRec3.Code != http.StatusConflict {
		t.Fatalf("re-claim status = %d, want %d", claimRec3.Code, http.StatusConflict)
	}

	// Unknown challenge is 404
	missing := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/claim", models.ClaimQRChallengeRequest{
		ChallengeID: "does-not-exist",
	}, "")
	missingRec := httptest.NewRecorder()
	handler.ClaimChallenge(missingRec, missing)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("missing claim status = %d, want %d", missingRec.Code, http.StatusNotFound)
	}
}

func TestQRApproveRejectsGuests(t *testing.T) {
	handler, _, guest := newTestQRLoginHandler(t)

	createReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/challenge", models.CreateQRChallengeRequest{
		PublicKey:  qrTestPublicKey,
		DeviceName: "Phone",
	}, "")
	createRec := httptest.NewRecorder()
	handler.CreateChallenge(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create status = %d", createRec.Code)
	}

	var created models.CreateQRChallengeResponse
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	approveReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/approve", models.ApproveQRChallengeRequest{
		ChallengeID: created.ChallengeID,
		PublicKey:   qrTestPublicKey,
	}, guest.ID)
	approveRec := httptest.NewRecorder()
	handler.ApproveChallenge(approveRec, approveReq)
	if approveRec.Code != http.StatusForbidden {
		t.Fatalf("guest approve status = %d, want %d", approveRec.Code, http.StatusForbidden)
	}
}

func TestQRCreateRejectsBadKey(t *testing.T) {
	handler, _, _ := newTestQRLoginHandler(t)

	createReq := qrAuthedRequest(t, http.MethodPost, "/api/auth/qr/challenge", models.CreateQRChallengeRequest{
		PublicKey:  "not-a-key",
		DeviceName: "Phone",
	}, "")
	createRec := httptest.NewRecorder()
	handler.CreateChallenge(createRec, createReq)
	if createRec.Code != http.StatusBadRequest {
		t.Fatalf("bad-key create status = %d, want %d", createRec.Code, http.StatusBadRequest)
	}
}
