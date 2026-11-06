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
	"slices"
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

// quitHandler cierra la app vía exit. Solo acepta POST y, si el browser
// manda Origin, tiene que ser uno de allowedOrigins — evita que una página
// externa mate el proceso con un fetch/form cross-site.
func quitHandler(allowedOrigins []string, exit func()) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !slices.Contains(allowedOrigins, origin) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		fmt.Fprintln(w, "Cerrando WiXplorer...")
		go exit()
	}
}

func main() {
	// Intenta el puerto 3000; si está ocupado, usa uno libre al azar.
	// Escuchar solo en localhost — el launcher MTP no debe ser accesible desde la red.
	listener, err := net.Listen("tcp", "127.0.0.1:3000")
	if err != nil {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
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

	// Endpoint /quit para cerrar la app limpiamente desde el browser.
	allowedOrigins := []string{url, fmt.Sprintf("http://127.0.0.1:%d", port)}
	mux.HandleFunc("/quit", quitHandler(allowedOrigins, func() {
		time.Sleep(200 * time.Millisecond)
		os.Exit(0)
	}))

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
