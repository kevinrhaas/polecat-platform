#!/usr/bin/env node
/**
 * stream-log.mjs — turn `claude -p --output-format stream-json` into a live run log.
 *
 *   claude -p "$PROMPT" --output-format stream-json --verbose … | node stream-log.mjs OUT [RAW]
 *
 * WHY THIS EXISTS. The steward used to run the agent as
 *
 *     claude -p "$PROMPT" … | tee /tmp/steward-out.txt
 *
 * and in `text` output mode the CLI prints nothing at all until the process
 * exits — the whole transcript is buffered and emitted as one final blob. The
 * step was therefore SILENT for its entire life. Improve run #977 (custom lane,
 * 2026-08-23) sat from 00:18 to 02:47 without printing a single line and was
 * cancelled at the 150-minute cap; because the buffer died with the process,
 * `tee` had written zero bytes and the journal got "(no summary captured)".
 * There was no way to tell a working run from a wedged one, and no evidence
 * left behind afterwards to decide which it had been — for two and a half hours
 * of lane time, three skipped scheduler ticks, and nothing shipped.
 *
 * WHAT IT DOES. Reads the NDJSON stream and, for every event, writes:
 *   - one compact human line to stdout, immediately (that is the live log), and
 *   - the raw event to RAW, appended synchronously, so a `kill -9` still leaves
 *     the full machine-readable trail up to the last thing the agent did.
 * Assistant prose is also appended to OUT as it arrives, so `journal.sh` has a
 * trail even when the run never reaches its final summary. When the terminal
 * `result` event does arrive, OUT is REPLACED by that summary — a run that
 * finishes normally journals the clean write-up the prompt asked for, exactly
 * as before, and only a run that died mid-flight journals a transcript tail.
 *
 * It is deliberately dumb: every handler is wrapped, an unparseable line is
 * echoed rather than thrown on, and nothing here can fail the run. `pipefail`
 * in the workflow still carries the agent's own exit code.
 */
import fs from 'node:fs'
import readline from 'node:readline'

const OUT = process.argv[2] || '/tmp/steward-out.txt'
const RAW = process.argv[3] || ''
const T0 = Date.now()

// Truncated fresh: a resumed slice must not journal the previous slice's tail.
try { fs.writeFileSync(OUT, '') } catch {}
if (RAW) { try { fs.writeFileSync(RAW, '') } catch {} }

const clock = () => {
  const s = Math.floor((Date.now() - T0) / 1000)
  return `${String(Math.floor(s / 60)).padStart(3, ' ')}:${String(s % 60).padStart(2, '0')}`
}
const say = (mark, text) => process.stdout.write(`[${clock()}] ${mark} ${text}\n`)
const append = (file, text) => { try { fs.appendFileSync(file, text) } catch {} }

// One line, no matter what came in — a wall of pasted file content in the log
// is as unreadable as no log at all, and the raw stream keeps the full text.
const flat = (s, n = 400) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + ` …(+${one.length - n} chars)` : one
}

// The one argument worth seeing per tool: which command, which file, which pattern.
const gist = (name, input) => {
  const i = input || {}
  if (i.command) return flat(i.command, 240)
  if (i.file_path) return flat(i.file_path + (i.old_string ? ' (edit)' : ''), 240)
  if (i.pattern) return flat(i.pattern + (i.path ? ` in ${i.path}` : ''), 240)
  if (i.description) return flat(i.description, 240)
  return flat(JSON.stringify(i), 160)
}

let tools = 0
let words = 0

function handle (ev) {
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        say('◆', `session ${ev.session_id || '?'} · model ${ev.model || '?'} · cwd ${ev.cwd || '?'}`)
      } else {
        say('◆', `${ev.subtype || 'system'} ${flat(ev.message || '', 200)}`)
      }
      break

    case 'assistant': {
      for (const block of ev.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          words += block.text.split(/\s+/).length
          say('▸', flat(block.text))
          append(OUT, block.text.trimEnd() + '\n\n')
        } else if (block.type === 'tool_use') {
          tools++
          say('·', `${block.name}: ${gist(block.name, block.input)}`)
        } else if (block.type === 'thinking') {
          say('~', `thinking (${(block.thinking || '').length} chars)`)
        }
      }
      break
    }

    case 'user': {
      // Tool results come back as user turns. Report the shape, not the payload.
      for (const block of ev.message?.content || []) {
        if (block.type !== 'tool_result') continue
        const body = Array.isArray(block.content)
          ? block.content.map(c => c.text || '').join('')
          : String(block.content ?? '')
        say(block.is_error ? '✗' : '←', `${block.is_error ? 'ERROR ' : ''}${flat(body, 200)}`)
      }
      break
    }

    case 'result': {
      const text = ev.result || ev.error || ''
      const mins = ((ev.duration_ms || (Date.now() - T0)) / 60000).toFixed(1)
      say('■', `${ev.subtype || 'result'} · ${mins} min · ${ev.num_turns ?? '?'} turns · ` +
               `${tools} tool calls · $${(ev.total_cost_usd ?? 0).toFixed(2)}`)
      // The prompt's closing summary — this is what the journal wants.
      if (String(text).trim()) {
        try { fs.writeFileSync(OUT, String(text).trimEnd() + '\n') } catch {}
        process.stdout.write('\n----- final summary -----\n' + String(text) + '\n')
      }
      break
    }

    // Token-level deltas (only emitted under --include-partial-messages, which
    // we do not pass). Kept in RAW, never rendered — one line per token would
    // bury the log it is meant to make readable.
    case 'stream_event':
      break

    default:
      say('?', `${ev.type} ${flat(JSON.stringify(ev), 200)}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', line => {
  if (!line.trim()) return
  if (RAW) append(RAW, line + '\n')
  let ev
  try {
    ev = JSON.parse(line)
  } catch {
    // Not JSON — a warning or a stray write. Show it; never drop it.
    say('|', flat(line, 400))
    return
  }
  try { handle(ev) } catch (err) { say('!', `stream-log could not render a ${ev.type} event: ${err.message}`) }
})

rl.on('close', () => {
  say('◇', `stream ended · ${tools} tool calls · ~${words} words of agent prose`)
})

// A broken pipe must not take the agent down with it.
process.stdout.on('error', () => {})
