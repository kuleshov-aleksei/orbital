package service

import (
	"log"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

const MaxChatMessagesPerRoom = 500

type ChatService struct {
	messages map[string][]*models.ChatMessage // room_id -> messages
	mu       sync.RWMutex
}

func NewChatService() *ChatService {
	return &ChatService{
		messages: make(map[string][]*models.ChatMessage),
	}
}

func (cs *ChatService) AddMessage(roomID, senderID, content string) (*models.ChatMessage, error) {
	if content == "" {
		return nil, &ChatError{Message: "Message content cannot be empty"}
	}
	if len(content) > 2000 {
		return nil, &ChatError{Message: "Message content exceeds 2000 characters"}
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()

	msg := &models.ChatMessage{
		ID:       generateChatID(),
		SenderID: senderID,
		Content:  content,
		SentAt:   time.Now(),
	}

	if cs.messages[roomID] == nil {
		cs.messages[roomID] = make([]*models.ChatMessage, 0, MaxChatMessagesPerRoom)
	}

	cs.messages[roomID] = append(cs.messages[roomID], msg)

	if len(cs.messages[roomID]) > MaxChatMessagesPerRoom {
		cs.messages[roomID] = cs.messages[roomID][1:]
	}

	log.Printf("[Chat] Message added to room %s from user %s", roomID, senderID)
	return msg, nil
}

func (cs *ChatService) GetMessages(roomID string) []*models.ChatMessage {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	messages := make([]*models.ChatMessage, len(cs.messages[roomID]))
	copy(messages, cs.messages[roomID])
	return messages
}

func (cs *ChatService) ClearRoom(roomID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if _, exists := cs.messages[roomID]; exists {
		delete(cs.messages, roomID)
		log.Printf("[Chat] Chat history cleared for room %s", roomID)
	}
}

func generateChatID() string {
	return time.Now().Format("20060102150405") + randomStringChat(8)
}

func randomStringChat(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(b)
}

type ChatError struct {
	Message string
}

func (e *ChatError) Error() string {
	return e.Message
}
