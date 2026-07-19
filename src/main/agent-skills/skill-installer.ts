import { app } from 'electron'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { renderMywbHelperScript, renderSkillMarkdown } from './skill-templates'

// Writes the My Whiteboard skill + helper into each coding agent's skill
// directory. Deliberately does NOT touch any agent's settings.json/hooks —
// only creates files inside a dedicated `my-whiteboard/` folder, so uninstall
// is "delete that folder" and nothing of the user's config is mutated.

const SKILL_DIR_NAME = 'my-whiteboard'

interface SkillTarget {
	host: string
	/** Directory that holds this agent's user skills, e.g. ~/.claude/skills. */
	skillsRoot: string
}

function candidateTargets(home: string): SkillTarget[] {
	return [
		{ host: 'Claude', skillsRoot: join(home, '.claude', 'skills') },
		{ host: 'Codex', skillsRoot: join(home, '.codex', 'skills') },
		{ host: 'Cursor', skillsRoot: join(home, '.cursor', 'skills') },
		{ host: 'Gemini', skillsRoot: join(home, '.gemini', 'skills') },
		{ host: 'Shared', skillsRoot: join(home, 'skills') }
	]
}

function serverJsonPath(): string {
	return join(app.getPath('userData'), 'server.json')
}

export interface InstallResult {
	host: string
	skillPath: string
	installed: boolean
	error?: string
}

/**
 * Install into every agent whose parent config dir already exists (so we don't
 * create ~/.gemini for someone who doesn't use Gemini). The shared ~/skills is
 * always installed. Returns per-target outcomes for the UI.
 */
export async function installAgentSkills(home = homedir()): Promise<InstallResult[]> {
	const sj = serverJsonPath()
	const results: InstallResult[] = []

	for (const target of candidateTargets(home)) {
		const skillDir = join(target.skillsRoot, SKILL_DIR_NAME)
		const skillPath = join(skillDir, 'SKILL.md')
		// Only Shared is created unconditionally; others require the agent's
		// config root (~/.claude etc.) to already exist.
		const configRoot = dirname(target.skillsRoot)
		if (target.host !== 'Shared' && !existsSync(configRoot)) continue
		try {
			await mkdir(skillDir, { recursive: true })
			const mywbPath = join(skillDir, 'mywb')
			await writeFile(skillPath, renderSkillMarkdown(sj, mywbPath))
			await writeFile(mywbPath, renderMywbHelperScript(sj))
			await chmod(mywbPath, 0o755)
			results.push({ host: target.host, skillPath, installed: true })
		} catch (error) {
			results.push({
				host: target.host,
				skillPath,
				installed: false,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	return results
}
