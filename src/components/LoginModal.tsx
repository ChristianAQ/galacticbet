import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { configured, emailLogin, googleLogin } from "../lib/firebase";
import { haptic } from "../lib/motion";
import Modal from "./Modal";
import { readableError } from "./ui";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export default function LoginModal({ close }: { close: () => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      haptic("success");
      close();
    } catch (e) {
      haptic("warning");
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={register ? "Pide tu ficha" : "Al vestuario"}
      busy={busy}
      onClose={close}
      className="login-sheet"
    >
      <p className="login-lede">
        {register
          ? "Un nombre, un correo y a jugar. Tus amigos te verán así en la tabla."
          : "Entra para jugar tus quinielas con tu grupo desde cualquier dispositivo."}
      </p>
      {!configured && (
        <p className="setup-notice">
          El acceso estará disponible al conectar Firebase. Mientras tanto,
          puedes explorar el modo demo desde Ligas.
        </p>
      )}
      <button
        type="button"
        className="button secondary full"
        disabled={!configured || busy}
        onClick={() => void run(googleLogin)}
      >
        <GoogleMark /> Continuar con Google
      </button>
      <div className="divider">
        <span>o con tu correo</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => emailLogin(email, password, register ? name : undefined));
        }}
      >
        {register && (
          <label>
            Nombre
            <input
              autoComplete="name"
              enterKeyHint="next"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como te llaman en el grupo"
            />
          </label>
        )}
        <label>
          Correo electrónico
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            enterKeyHint="go"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={register ? "Mínimo 6 caracteres" : undefined}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={!configured || busy}>
          {busy ? "Entrando…" : register ? "Crear cuenta" : "Entrar"}
          <ArrowRight size={17} />
        </button>
      </form>
      <button
        type="button"
        className="text-button register-toggle"
        onClick={() => {
          setError("");
          setRegister(!register);
        }}
      >
        {register ? "Ya tengo cuenta" : "¿Primera vez? Crea tu cuenta"}
      </button>
    </Modal>
  );
}
