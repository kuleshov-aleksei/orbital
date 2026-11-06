package service

import (
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

func TestUpdateUserMediaState(t *testing.T) {
	rs := NewRoomService(nil, nil)
	room, err := rs.CreateRoom("R", "general", 10, "voice")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}

	state := models.UpdateMediaStateRequest{RoomID: room.ID, IsMuted: true, IsScreenSharing: true, IsCameraEnabled: true}
	if _, ok := rs.UpdateUserMediaState(room.ID, "u1", state); ok {
		t.Fatal("update for non-member should be rejected")
	}

	if _, _, err := rs.JoinRoom(room.ID, "u1", "Alice"); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	changed, ok := rs.UpdateUserMediaState(room.ID, "u1", state)
	if !ok || !changed {
		t.Fatalf("first update: changed=%v ok=%v, want true,true", changed, ok)
	}
	if changed, _ := rs.UpdateUserMediaState(room.ID, "u1", state); changed {
		t.Fatal("identical snapshot should report unchanged")
	}

	got, ok := rs.GetUserMediaState(room.ID, "u1")
	if !ok || !got.IsMuted || got.IsDeafened || !got.IsScreenSharing || !got.IsCameraEnabled {
		t.Fatalf("stored state = %+v", got)
	}

	preview := rs.getRoomPreviewUsers(room.ID)
	if len(preview) != 1 || !preview[0].IsCameraEnabled || !preview[0].IsScreenSharing {
		t.Fatalf("preview users = %+v", preview)
	}
	if users := rs.GetRoomUsers(room.ID); len(users) != 1 || !users[0].IsCameraEnabled {
		t.Fatalf("room users = %+v", users)
	}
	if all := rs.GetAllMediaStates(); len(all) != 1 || all[0].UserID != "u1" || all[0].RoomID != room.ID {
		t.Fatalf("all media states = %+v", all)
	}
}

func TestMediaStateClearedOnLeave(t *testing.T) {
	rs := NewRoomService(nil, nil)
	room, err := rs.CreateRoom("R", "general", 10, "voice")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, _, err := rs.JoinRoom(room.ID, "u1", "Alice"); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	rs.UpdateUserMediaState(room.ID, "u1", models.UpdateMediaStateRequest{IsMuted: true, IsScreenSharing: true})
	rs.LeaveRoom(room.ID, "u1")

	if len(rs.GetAllMediaStates()) != 0 {
		t.Fatal("media state should be removed with the member")
	}

	_, preview, err := rs.JoinRoom(room.ID, "u1", "Alice")
	if err != nil {
		t.Fatalf("rejoin: %v", err)
	}
	if preview.IsMuted || preview.IsScreenSharing {
		t.Fatalf("rejoin carried stale state: %+v", preview)
	}
}
