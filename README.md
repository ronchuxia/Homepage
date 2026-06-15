# Homepage

A personal website hosting a browsable notes library and interactive canvases.

**Live:** `http://xiachu-homepage.s3-website-us-east-1.amazonaws.com`

## Tech Stack

- **Vite**: development server and production bundler.
- **React 19**: single-page application with client-side routing (React Router).
- **Tailwind CSS**: styling.
- **react-markdown, KaTeX, highlight.js**: Markdown rendering with mathematics and syntax highlighting.

## Architecture

### Notes Pipeline

Notes are authored in Markdown and stored in a separate repository,
[`ronchuxia/Notes`](https://github.com/ronchuxia/Notes). A build script
(`frontend/scripts/build-notes-index.mjs`) traverses the notes, copies the
Markdown and image assets into the site, and generates `index.json`, which
contains the sidebar tree and a slug-to-path map. The Notes page fetches this
index and renders each note on demand.

### Hosting (AWS S3)

The production build is a static bundle served from an S3 bucket
(`xiachu-homepage`) configured for static website hosting.

### Continuous Deployment (GitHub Actions)

On every push to `main`,
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) performs the
following:

1. Clones the notes repository.
2. Builds the notes index and the Vite bundle.
3. Authenticates to AWS using OIDC, assuming a scoped IAM role
   (`github-actions-homepage-deploy`). No long-lived AWS credentials are stored
   in GitHub.
4. Synchronizes the build output to S3 and applies cache-control headers.

### Content Synchronization (Github Actions)

The notes repository contains a workflow that emits a `repository_dispatch`
event (`notes-updated`) on each push. `deploy.yml` subscribes to this event and
redeploys the site. Publishing a note therefore rebuilds and republishes the
website automatically, with no changes required in this repository.

## Local Development

```bash
cd frontend
npm install
npm run build:notes   # build the notes index from ../notes (local vault symlink)
npm run dev           # serves http://localhost:5173
```

## Repository Layout

```
.github/workflows/deploy.yml          CI: build and deploy to S3 via OIDC
frontend/                             React and Vite application
  scripts/build-notes-index.mjs       notes index builder
```
