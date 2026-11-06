package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestQuitHandler(t *testing.T) {
	origins := []string{"http://localhost:3000", "http://127.0.0.1:3000"}

	tests := []struct {
		name     string
		method   string
		origin   string
		wantCode int
		wantExit bool
	}{
		{"POST same-origin", http.MethodPost, "http://localhost:3000", http.StatusOK, true},
		{"POST desde 127.0.0.1", http.MethodPost, "http://127.0.0.1:3000", http.StatusOK, true},
		{"POST sin Origin (no browser)", http.MethodPost, "", http.StatusOK, true},
		{"GET rechazado", http.MethodGet, "http://localhost:3000", http.StatusMethodNotAllowed, false},
		{"POST cross-site", http.MethodPost, "https://evil.example", http.StatusForbidden, false},
		{"POST otro puerto local", http.MethodPost, "http://localhost:8080", http.StatusForbidden, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exited := make(chan struct{}, 1)
			h := quitHandler(origins, func() { exited <- struct{}{} })

			req := httptest.NewRequest(tt.method, "/quit", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			h(rec, req)

			if rec.Code != tt.wantCode {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantCode)
			}
			select {
			case <-exited:
				if !tt.wantExit {
					t.Error("exit llamado, no debería")
				}
			case <-time.After(100 * time.Millisecond):
				if tt.wantExit {
					t.Error("exit no fue llamado")
				}
			}
		})
	}
}
