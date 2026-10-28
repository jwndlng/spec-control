#!/usr/bin/env bun
// A stand-in for an editor's command-line launcher (`code`, `zed`, …): records how it was started — its arguments and
// working directory — as one JSON line in the file `FAKE_EDITOR_LOG` names, then exits at once, as `code` does after
// handing off. Tests never start a real editor.
import { appendFileSync } from "node:fs";

const log = process.env.FAKE_EDITOR_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`);
