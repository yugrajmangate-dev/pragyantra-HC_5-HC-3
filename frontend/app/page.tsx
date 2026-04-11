"use client";

import ReportForm from "@/components/ReportForm";
import type { OutbreakResponse } from "@/components/ReportForm";
import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const [latestPrediction, setLatestPrediction] = useState<OutbreakResponse | null>(null);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState("");

  useEffect(() => {
    const loggedInUser = localStorage.getItem("clinic_logged_in_user");
    if (loggedInUser) {
      setCurrentUser(loggedInUser);
      setIsLoggedIn(true);
    }
  }, []);

  function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    const users = JSON.parse(localStorage.getItem("clinic_users") || "{}");
    
    if (isLoginMode) {
      if (users[username] && users[username] === password) {
        localStorage.setItem("clinic_logged_in_user", username);
        setCurrentUser(username);
        setIsLoggedIn(true);
        setError("");
      } else {
        setError("Incorrect username or password.");
      }
    } else {
      if (users[username]) {
        setError("Username already exists.");
      } else if (username.length < 3 || password.length < 3) {
        setError("Username and password must be at least 3 characters.");
      } else {
        users[username] = password;
        localStorage.setItem("clinic_users", JSON.stringify(users));
        localStorage.setItem("clinic_logged_in_user", username);
        setCurrentUser(username);
        setIsLoggedIn(true);
        setError("");
      }
    }
  }

  function handleLogout() {
    localStorage.removeItem("clinic_logged_in_user");
    setIsLoggedIn(false);
    setCurrentUser("");
    setUsername("");
    setPassword("");
    setLatestPrediction(null);
  }

  // --- Auth UI View ---
  if (!isLoggedIn) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 text-slate-100 p-4">
        <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-float-slow" />
        <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl animate-float-slow [animation-delay:2s]" />
  
        <div className="z-10 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/90 p-8 shadow-xl shadow-cyan-900/20 backdrop-blur">
          <h1 className="mb-2 text-2xl font-semibold text-center text-cyan-100">Clinic Provider Login</h1>
          <p className="mb-6 text-center text-sm text-slate-400">
            {isLoginMode ? "Sign in to access the Rural Health Report Box" : "Create a new clinic provider account"}
          </p>
  
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-slate-300">Provider Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                autoComplete="off"
                required
              />
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
            >
              {isLoginMode ? "Sign In" : "Register Clinic Account"}
            </button>
          </form>
          
          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setIsLoginMode(!isLoginMode);
                setError("");
              }}
              className="text-xs text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/50 underline-offset-4"
            >
              {isLoginMode ? "Need an account? Add New Account" : "Already have an account? Sign In"}
            </button>
          </div>

          <div className="mt-8 text-center text-xs text-slate-500 border-t border-white/5 pt-4">
            <Link href="/admin" className="hover:text-cyan-400 underline decoration-slate-500 underline-offset-4">
              Health Authority Admin Portal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Logged In Clinic View ---
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 text-slate-100 p-4">
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl animate-float-slow [animation-delay:2s]" />

      <header className="absolute top-0 left-0 w-full border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-300">Outbreak Radar</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Public Health Clinic Portal</h1>
          </div>
          <div className="flex gap-4 items-center">
            <span className="text-xs text-emerald-400">Clinic: {currentUser}</span>
            <button onClick={handleLogout} className="rounded border border-rose-500/30 hover:border-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition px-3 py-1 text-xs font-mono text-rose-300 cursor-pointer">
              Log out
            </button>
            <Link href="/admin" className="rounded-full border border-slate-700 hover:border-cyan-400 bg-slate-800 hover:bg-slate-700 transition px-4 py-1.5 text-xs font-mono tracking-wider text-slate-300 hover:text-cyan-100 cursor-pointer hidden sm:block">
                Admin Portal
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex w-full max-w-lg flex-col gap-6 mt-16">
        <div className="text-center animate-rise-in">
          <h2 className="text-2xl sm:text-3xl font-bold text-cyan-50 shadow-sm mb-2">Rural Health Report Box</h2>
          <p className="text-sm text-slate-300">
            Submit local disease metrics to automatically update the centralized Outbreak Radar.
          </p>
        </div>

        <div className="animate-rise-in w-full [animation-delay:140ms]">
          <ReportForm onPrediction={setLatestPrediction} />
        </div>

        {latestPrediction && (
          <div className="animate-rise-in [animation-delay:200ms] rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center backdrop-blur">
            <p className="text-emerald-100 text-sm font-medium">Report submitted successfully.</p>
            <p className="text-slate-300 text-xs mt-1">Data synced with admin dashboard. Initial Risk Assessment: {latestPrediction.status}</p>
          </div>
        )}
      </main>

      <footer className="absolute bottom-4 text-xs text-slate-500">
        Empowering early responses through continuous surveillance
      </footer>
    </div>
  );
}
