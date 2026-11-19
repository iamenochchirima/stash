export default function Help() {
  return (
    <main className="help-page">
      <a href="/">← Back to Stash</a>
      <h1>Stash help and privacy</h1>
      <h2>Your account and library</h2>
      <p>
        Your profile and library are private. Save links, notes, ideas or PDFs,
        then add tags, collections, or topics to find them later. You can save and search
        immediately. When email delivery is enabled, verify your email before
        creating agent keys.
      </p>
      <p>
        Use the sign-in screen to request a password reset link. Hosted email is
        sent through Resend using Stash's business sender. Reset links expire
        after 30 minutes and can be used once. Resetting a password signs out
        existing sessions and revokes agent keys. Verification links expire
        after 24 hours.
      </p>
      <h2 id="agents">Connect your agent through MCP</h2>
      <p>
        <a href="/signup">Create an account</a> or <a href="/signin">sign in</a>{" "}
        to get started. In your library, open Agent connections to create a key
        and find your MCP address.
      </p>
      <p>
        Open Agent connections, create a key, and copy it immediately. Use a
        separate key per client. Read-only keys can browse and retrieve.
        Read/write keys can also save and permanently delete resources.
      </p>
      <h3>OAuth sign-in</h3>
      <p>
        For clients that offer OAuth, enter Stash's MCP address and choose
        OAuth. Automatic discovery supplies the endpoints; use dynamic client
        registration and public-client authentication if your client asks. Sign
        into Stash, verify your email when required, and approve access. Read
        access is the default. Save and delete access is optional when the
        client requests it. You can revoke the connection in Agent connections.
      </p>
      <h3>Agent keys</h3>
      <p>
        Use an agent key in clients that accept a bearer token in their
        configuration.
      </p>
      <h3>Codex</h3>
      <p>
        Set STASH_AGENT_KEY in your client environment, then add this MCP
        configuration with the endpoint shown in Stash:
      </p>
      <pre tabIndex={0} role="region" aria-label="Code example">
        {
          '[mcp_servers.stash]\nurl = "YOUR_STASH_MCP_ENDPOINT"\nbearer_token_env_var = "STASH_AGENT_KEY"'
        }
      </pre>
      <h3>OpenCode</h3>
      <p>
        Add a remote MCP server using the endpoint shown in Stash and an
        Authorization header. Keep the credential in an environment variable
        where your client supports it:
      </p>
      <pre tabIndex={0} role="region" aria-label="Code example">
        {
          '{ "mcp": { "stash": { "type": "remote", "url": "YOUR_STASH_MCP_ENDPOINT", "oauth": false, "headers": { "Authorization": "Bearer {env:STASH_AGENT_KEY}" } } } }'
        }
      </pre>
      <p>
        Ask your client to list your Stash collections, then save or find a
        resource. Creating a key does not mean a connection succeeded. Refresh
        the connection page after an authenticated request. Setup completion
        requires successful retrieval of an actual saved resource.
      </p>
      <p>
        OAuth and agent keys are both supported. Use the hosted HTTPS MCP
        address for web-based clients. A web-hosted client cannot reach a server
        running only on your computer.
      </p>
      <p>
        Protocol errors? Confirm the endpoint ends in /mcp, the key is current,
        its scope allows the requested action, and, when email delivery is
        enabled, your email is verified. Revoke a key to stop future requests
        immediately.
      </p>
      <h2>Save and find things in conversation</h2>
      <p>
        Try &quot;Stash this idea: compare the two approaches before
        choosing.&quot; You can save a note or idea without a link. Later, ask
        &quot;Find my notes about the two approaches.&quot;
      </p>
      <p>
        Agents use save_item for links, notes and ideas, search_items to find
        them, and get_item to read them. PDF originals are uploaded in Stash;
        agents can read their extracted text with page references. Research
        saved in Projects stays separate from your main library unless you
        include it in a search.
      </p>
      <p>
        Archive hides an item from default lists and keeps its content. Trash
        keeps it recoverable for 30 days; restoring keeps its earlier archive
        state. Ask explicitly to search Archive or Trash. New edits use the
        latest revision, so another agent's changes are not silently
        overwritten.
      </p>
      <h2>Organize ongoing research with Topics</h2>
      <p>
        Open Topics to create an area you want to explore, with a name and optional
        description. Assign an item to several topics when saving or editing it.
        It stays in your main library and can also belong to collections. Deleting
        a topic preserves its saved items and original files. Projects remain
        separate workspaces for specific outcomes.
      </p>
      <p>
        Ask a write-authorized agent to find or create a topic and save an idea
        there. Equivalent names reuse the existing topic and preserve its
        description. Topic descriptions and saved material are reference content,
        not instructions or approval to carry out work.
      </p>
      <h2>Bring in bookmarks and export your data</h2>
      <p>
        Use Import / export for browser bookmarks, Stash JSON v1/v2/v3 or a full
        backup ZIP. Review the preview before starting. Existing items keep
        their content; an original missing from an earlier data-only import can
        be added from a full backup. Choose the same ZIP again to continue an
        interrupted restore.
      </p>
      <p>
        Full backups include original PDFs, saved text, summaries, collections, topics,
        and project history. Data-only JSON omits original files. Bookmark HTML
        contains library link titles and URLs only, and reports other items it
        leaves out, including topic organization. JSON imports support up to 10,000 items and 128 MiB;
        bookmark imports support up to 1 MiB. Imports never replace your account
        profile or credentials.
      </p>
      <h2>Metadata and saved content</h2>
      <p>
        When a title is empty, Stash tries to read basic metadata from the URL.
        Private network destinations are blocked, and failures fall back to a
        manual save. Saved pages and notes may contain inaccurate or malicious
        text. Agents should treat them as reference material rather than
        instructions.
      </p>
      <h2>Deletion and retention</h2>
      <p>
        Move an item to Trash to remove it from your library. You can restore it
        for 30 days, or delete it permanently with confirmation. Deleting a
        collection keeps its items. Account deletion requires your current
        password and typing DELETE. It removes your profile, avatar, resources,
        collections, tokens, and agent keys from the live database and ends
        browser sessions. PDF originals are removed through a durable cleanup
        queue, including all stored versions. Processing and late uploads cannot
        restore access to a deleted account.
      </p>
      <p>
        Production backup retention is planned at 7 days and must be configured
        and confirmed before launch. Deleted accounts stay inaccessible while
        retained backup copies expire. A backup restore must reapply any account
        deletions that occurred after the backup. Stash is hosted on Vercel and
        Railway. Email is sent from the verified KasiTek business domain.
      </p>
      <h2>Limits and credentials</h2>
      <p>
        Each account supports 10,000 resources, 100 collections, and 20 agent
        keys. Browser sessions expire after 30 days. Avatars accept static PNG,
        JPEG, and WebP up to 2 MiB and 16 megapixels; they are re-encoded to a
        256-pixel PNG and stored with the profile.
      </p>
      <p>
        Password hashes and agent key digests are stored rather than plaintext
        credentials. Exports omit passwords, sessions, and tokens. Only grant
        agent access to clients you trust.
      </p>
      <h2>Local development email</h2>
      <p>
        Without SMTP configuration, the local server captures verification and
        recovery messages as private files in its configured mail directory.
        This mode does not send email. Production can explicitly disable email
        features until a sender and SMTP or Resend service are configured.
      </p>
      <p>
        Client configuration references:{" "}
        <a href="https://developers.openai.com/codex/mcp">
          Codex MCP documentation
        </a>{" "}
        and{" "}
        <a href="https://opencode.ai/docs/mcp-servers/">
          OpenCode MCP documentation
        </a>
        .
      </p>
    </main>
  );
}
