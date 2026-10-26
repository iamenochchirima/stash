"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { AppShell, useWorkspace } from "../workspace/workspace";
export function TopicsPage() {
  const { topics, createTopic } = useWorkspace();
  const [query, setQuery] = useState("");
  const matches = topics.filter((topic) =>
    `${topic.name} ${topic.description || ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <AppShell>
      <main className="main">
        <div className="content">
          <div className="page-heading">
            <div>
              <h1>Topics</h1>
              <p>Keep research and ideas together across your library.</p>
            </div>
            <button className="button primary" onClick={createTopic}>
              <Plus size={18} />
              New topic
            </button>
          </div>
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="Search topics"
              placeholder="Search topics…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {matches.length ? (
            <ul className="topic-list">
              {matches.map((topic) => (
                <li key={topic.id}>
                  <Link href={`/topics/${topic.id}`}>
                    <div>
                      <strong>{topic.name}</strong>
                      {topic.description && <p>{topic.description}</p>}
                    </div>
                    <span>
                      {topic.itemCount}{" "}
                      {topic.itemCount === 1 ? "item" : "items"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <h2>{query ? "No matching topics" : "No topics yet"}</h2>
              <p>
                {query
                  ? "Try another search."
                  : "Create a topic for an area you want to explore."}
              </p>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
