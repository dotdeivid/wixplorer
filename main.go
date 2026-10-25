package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

//go:embed dist
var distFiles embed.FS

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default:
		cmd = "xdg-open"
		args = []string{url}
	}
	exec.Command(cmd, args...).Start() //nolint:errcheck
}

func main() {
	// Intenta el puerto 3000; si está ocupado, usa uno libre al azar.
	listener, err := net.Listen("tcp", ":3000")
	if err != nil {
		listener, err = net.Listen("tcp", ":0")
		if err != nil {
			fmt.Println("Error: no se pudo iniciar el servidor:", err)
			return
		}
	}

	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://localhost:%d", port)

	public, _ := fs.Sub(distFiles, "dist")
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(public)))

	// Endpoint /quit para cerrar la app limpiamente desde el browser
	mux.HandleFunc("/quit", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Cerrando WiXplorer...")
		go func() {
			time.Sleep(200 * time.Millisecond)
			os.Exit(0)
		}()
	})

	fmt.Printf("WiXplorer en %s\n", url)

	// Esperar a que el servidor esté listo antes de abrir el browser
	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser(url)
	}()

	if err := http.Serve(listener, mux); err != nil {
		fmt.Println("Servidor detenido:", err)
	}
}
