// The agent detail view is the same workspace component as the index; it reads
// the selected agent id from the URL (useParams), so /workflows/agents/<id> is a
// real, shareable page. Re-export the client component from the index route.
export { default } from "../page";
