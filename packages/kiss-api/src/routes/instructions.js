import { listPendingInstructions } from "../db/repo.js";

export async function listInstructionsHandler(req, res) {
  const target_app = req.query.target_app ? String(req.query.target_app) : null;
  const location_id = req.query.location_id ? String(req.query.location_id) : null;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 25;

  const instructions = await listPendingInstructions({ target_app, location_id, limit });

  res.status(200).json({ ok: true, count: instructions.length, instructions });
}
