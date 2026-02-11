Deployment policy

- Never edit repository code directly on the server.
- Make changes locally, create a commit, push to origin, then SSH to the server and run:
  ```bash
  cd /opt/registry/backend
  git pull
  docker compose -f compose.yaml -f compose.override.yaml up -d --build backend
  ```
- If changes need to be rolled-back on server, reset to the remote branch:
  ```bash
  git fetch --all
  git reset --hard origin/<branch>
  ```
- For safety, add a CI check or a protected branch in the future to automate deployment and prevent direct server edits.
