// Where the backend listens and the origin the browser sees. Read per call so a deployment can
// set them at run time.
export const apiUrl = () =>
  process.env.SERMO_API_URL ?? "http://127.0.0.1:8787";
export const publicUrl = () =>
  process.env.SERMO_PUBLIC_URL ?? "http://localhost:3000";
