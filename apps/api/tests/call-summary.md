# On-demand post-call summaries

Run database migrations before starting the updated API (`npm run db:migrate`).
Configure the existing `GEMINI_API_KEY` and `GEMINI_MODEL` variables.

When a call includes at least one Web participant with `MediaRecorder` and Web Audio
support (either as initiator or as the answering Web participant for an Android-initiated
call) and AI is configured, the designated Web tab captures mixed call audio and uploads
it silently to `POST /api/v1/calls/:id/recording` once an answered call ends.

Ending a call **never** automatically runs Gemini or posts messages into the shared
conversation. Instead, the call history card in chat (`Cuộc gọi thoại` / `Cuộc gọi video`)
displays an on-demand **`✨ Tóm tắt AI`** button for authorized conversation members on
both Web and Android. Clicking **`✨ Tóm tắt AI`** calls `POST /api/v1/calls/:id/summary`,
generates (or loads from encrypted cache) the Vietnamese summary, decisions, and tasks,
and renders the card privately right beneath the call bubble only for the user who
clicked it (with a Hide button, just like voice message transcription).

Limits: 30 minutes / 8 MB; keep the recording web tab open briefly after hangup so the
recording finishes saving. Calls where all participants use native Android only are not
recorded locally. Mixed audio does not identify participants by name. Unexpected
disconnection and recording limits discard the recording rather than summarizing
incomplete content.

Automated checks: build API, then run `node --test apps/api/tests/call-summary.test.cjs apps/web/tests/call-recorder.test.mjs`.
