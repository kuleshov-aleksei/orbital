package main

import (
	"log"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	// Connect to WebSocket
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/ws/20260127162207PLcrTm"}
	log.Printf("Connecting to %s", u.String())

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer c.Close()

	// Send join room message
	joinMsg := map[string]interface{}{
		"type": "join_room",
		"data": map[string]string{
			"user_id":  "test-user-1",
			"nickname": "TestUser",
		},
	}

	if err := c.WriteJSON(joinMsg); err != nil {
		log.Fatal("write:", err)
	}

	// Read messages
	go func() {
		for {
			var message map[string]interface{}
			err := c.ReadJSON(&message)
			if err != nil {
				log.Println("read:", err)
				return
			}
			log.Printf("Received: %v", message)
		}
	}()

	// Send speaking status update
	time.Sleep(2 * time.Second)
	speakingMsg := map[string]interface{}{
		"type": "speaking_status",
		"data": map[string]bool{
			"is_speaking": true,
		},
	}
	if err := c.WriteJSON(speakingMsg); err != nil {
		log.Fatal("write:", err)
	}

	// Keep connection open
	time.Sleep(10 * time.Second)
}
