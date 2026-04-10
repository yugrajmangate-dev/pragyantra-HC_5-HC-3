# Assistant API key setup

This project supports an LLM-backed `AI Field Assistant` that can be powered by OpenAI or Anthropic (Claude).

Do NOT commit your API keys. Use GitHub Secrets for CI and a local `.env` file for development.

Local development
- Create `backend/.env` (not committed) with the following:

```
ASSISTANT_PROVIDER=openai
ASSISTANT_API_KEY=sk-...
ASSISTANT_OPENAI_MODEL=gpt-3.5-turbo
```

Or for Anthropic/Claude:

```
ASSISTANT_PROVIDER=anthropic
ASSISTANT_API_KEY=ak-...
```

Restart the backend after adding the key.

CI / GitHub Actions
- The included workflow `.github/workflows/ci.yml` will run an optional assistant smoke test when the repository secret `ASSISTANT_API_KEY` is configured.
- To add the secret via GitHub UI: Repository -> Settings -> Secrets -> Actions -> New repository secret. Set `ASSISTANT_API_KEY`.
- Alternatively, use the GitHub CLI:

```bash
# install and authenticate gh first
gh secret set ASSISTANT_API_KEY --body "sk-..."
# optionally set provider
gh secret set ASSISTANT_PROVIDER --body "openai"
```

Security
- Keep keys limited and rotate them regularly.
- The workflow only runs the smoke test when the secret is present; the key is never printed or committed.
