// Awaited stdout/stderr writes: the CLI calls process.exit() when done
// (tldraw keeps the event loop alive), so writes must be flushed before that
// happens — especially when the stream is a pipe.
export function writeStdout(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		process.stdout.write(text, (error) => (error ? reject(error) : resolve()))
	})
}

export function writeStderr(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		process.stderr.write(text, (error) => (error ? reject(error) : resolve()))
	})
}
