"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { AppShell, useWorkspace } from "../workspace/workspace";
import { ProfileForm } from "./profile-form";
import { ErrorNote } from "../ui/error-note";
import { api } from "../../lib/api";
export function ProfilePageClient() {
  const { user, setUser } = useWorkspace(),
    router = useRouter();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const leave = () => {
    window.location.assign("/");
  };
  return (
    <AppShell>
      <main className="main">
        <div className="content">
          <div className="page-heading">
            <h1>Profile</h1>
          </div>
          <ErrorNote message={error} />
          {notice && <p role="status">{notice}</p>}
          <ProfileForm
            user={user}
            onDeleted={leave}
            onUser={(u) => {
              setUser(u);
              setNotice("Profile updated.");
            }}
          />
          <button
            className="button secondary logout"
            onClick={() =>
              api("/auth/logout", { method: "POST" })
                .then(leave)
                .catch((e) => setError(e.message))
            }
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
        <footer className="main-footer">
          <a href="/help">Help & privacy</a>
        </footer>
      </main>
    </AppShell>
  );
}
