// ABOUTME: Starts the Rust API and Vite from the repository root.
// ABOUTME: Stops both child process groups when the development command exits.

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const folder = process.argv[2] ?? '.'
const children = new Set()
let stopping = false

function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}

function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try { process.kill(-child.pid, signal) } catch { /* Already exited. */ }
  }
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

const rust = start('cargo', ['run', '--', folder, '--port', '4747', '--no-open'])
rust.on('error', (error) => { console.error(`Could not start Rust: ${error.message}`); stop(); process.exitCode = 1 })

let ready = false
while (!stopping && rust.exitCode === null) {
  try {
    const response = await fetch('http://127.0.0.1:4747/api/files', { signal: AbortSignal.timeout(1000) })
    if (response.ok) { ready = true; break }
  } catch { /* Rust may still be compiling. */ }
  await delay(250)
}

if (ready && !stopping && rust.exitCode === null) {
  const vite = start('npm', ['--prefix', 'web', 'run', 'dev'])
  vite.on('error', (error) => { console.error(`Could not start Vite: ${error.message}`); stop(); process.exitCode = 1 })
  console.log('\nOpen http://127.0.0.1:5173/ — Ctrl+C stops both servers.\n')
  await Promise.race([
    new Promise((done) => rust.on('exit', done)),
    new Promise((done) => vite.on('exit', done)),
  ])
  if (!stopping) { process.exitCode = 1; stop() }
} else if (!stopping) {
  process.exitCode = rust.exitCode || 1
}
