# LLM Explorer

## Deploy on Vercel

1. Import this project into Vercel and deploy it with the default settings. The static page is `index.html`; chat requests are handled by `api/chat.js`.
2. In the Vercel project settings, add `GROQ_API_KEY` as an environment variable for the environments you will use. Use a newly generated key; revoke the key previously shared in chat. Never put the key in `index.html`, commit it, or send it in a message.
3. Optionally set `GROQ_MODEL` to a model available to your Groq account. If unset, the endpoint uses `llama-3.3-70b-versatile`.
4. Redeploy after setting or changing environment variables, then open the deployed site and try the playground.

The browser calls the same-origin `/api/chat` endpoint; only the serverless function reads the API key. The endpoint checks request origin, limits request size and prompt length, and applies a best-effort per-instance rate limit. For a public production deployment, also configure platform-level usage limits and abuse protection.
