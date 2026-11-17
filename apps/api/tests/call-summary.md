# Post-call summaries

Run database migrations before starting the updated API (`npm run db:migrate`).
Configure the existing `GEMINI_API_KEY` and `GEMINI_MODEL` variables.

Web initiators with MediaRecorder and Web Audio support enable summaries automatically
when AI is configured. Participants see a recording notice on web and Android.
After an answered call ends, the initiating web tab uploads the mixed audio and
the API posts a Vietnamese summary, decisions and tasks to the conversation.
The summary uses the normal encrypted message storage and realtime delivery path.
Audio remains in browser memory until uploaded and is not saved as an attachment.

Limits: 30 minutes / 8 MB; keep the initiating web tab open through processing.
Native Android initiation does not yet capture audio. It can participate in a call
initiated on web and receive the resulting summary. Mixed audio does not identify
participants by name. Unexpected disconnection and recording limits reject the
recording rather than silently summarizing incomplete content. Provider or upload
failures can be retried while the initiating tab remains open.

Manual verification with two accounts:

1. Start an audio call on web and accept on another web tab or Android.
2. Verify the recording notice is visible before accepting and during the call.
3. Speak a decision and a task from both accounts; end from either side.
4. Verify exactly one AI summary arrives in chat for both participants.
5. Repeat with video, muted/unmuted microphone and a participant joining late.
6. Reject a ringing call: no recording or summary should be produced.
7. Interrupt the upload or disable Gemini, then use the retry button.
8. Reload chat and verify the saved summary remains available.

Automated checks: build API, then run `node --test apps/api/tests/call-summary.test.cjs apps/web/tests/call-recorder.test.mjs`.
