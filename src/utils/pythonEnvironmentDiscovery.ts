import * as path from "path";
import * as fs from "fs";
import {execFile} from "child_process";
import {promisify} from "util";
import {App, FileSystemAdapter, Platform} from "obsidian";
import {validatePythonPath} from "./pythonPathUtils";
import type {NotebookExecutionContext} from "../kernels/ExecutionContexts";

const execFileAsync = promisify(execFile);

export type PythonEnvironmentInfo = {
	label: string;
	path: string;
	version: string;
	type: "venv" | "system";
	source?: "pyenv" | "project";
	unavailable?: boolean;
};

export function formatPythonEnvironmentLabel(label: string, version: string): string {
	return version && version !== "unknown" ? `${label} (${version})` : label;
}

function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

async function getPythonVersion(pythonPath: string): Promise<string> {
	try {
		const {stdout, stderr} = await execFileAsync(pythonPath, ["--version"], {timeout: 3000});
		const output = (stdout || stderr).trim();
		const match = output.match(/Python\s+(\S+)/i);
		return match ? match[1] : "unknown";
	} catch {
		return "unknown";
	}
}

async function probeInterpreter(
	pythonPath: string,
	label: string,
	type: "venv" | "system",
	source?: PythonEnvironmentInfo["source"]
): Promise<PythonEnvironmentInfo | null> {
	if (!await validatePythonPath(pythonPath)) return null;
	return {
		label,
		path: pythonPath,
		version: await getPythonVersion(pythonPath),
		type,
		source,
	};
}

export async function getPythonEnvironmentInfo(
	app: App,
	interpreter: string
): Promise<PythonEnvironmentInfo | null> {
	const environments = await discoverPythonEnvironments(app);
	const match = environments.find((environment) => environment.path === interpreter);
	if (match) return match;

	const label = path.isAbsolute(interpreter) ? path.basename(interpreter) || interpreter : interpreter;
	return probeInterpreter(interpreter, label, "system");
}

function getVenvPythonPath(envDir: string): string {
	return Platform.isWin
		? path.join(envDir, "Scripts", "python.exe")
		: path.join(envDir, "bin", "python");
}

async function getPyenvRoots(): Promise<string[]> {
	const roots: string[] = [];
	try {
		const {stdout} = await execFileAsync("pyenv", ["root"], {timeout: 3000});
		if (stdout.trim()) roots.unshift(stdout.trim());
	} catch {
		// pyenv may not be installed or available on PATH.
	}

	return Array.from(new Set(roots.filter(Boolean)));
}

function getPyenvVersionPythonPath(versionDir: string): string {
	return Platform.isWin
		? path.join(versionDir, "python.exe")
		: path.join(versionDir, "bin", "python");
}

function getPyenvInterpreterCandidates(pyenvRoots: string[]): string[] {
	const candidates: string[] = [];

	for (const pyenvRoot of pyenvRoots) {
		candidates.push(
			path.join(pyenvRoot, "shims", "python"),
			path.join(pyenvRoot, "shims", "python3")
		);

		const versionsDir = path.join(pyenvRoot, "versions");
		if (!fs.existsSync(versionsDir)) continue;

		try {
			for (const entry of fs.readdirSync(versionsDir, {withFileTypes: true})) {
				if (entry.isDirectory()) {
					candidates.push(getPyenvVersionPythonPath(path.join(versionsDir, entry.name)));
				}
			}
		} catch {
			// Ignore unreadable pyenv roots.
		}
	}

	return Array.from(new Set(candidates));
}

function isPyenvInterpreterCandidate(candidate: string, pyenvRoots: string[]): boolean {
	if (!path.isAbsolute(candidate)) return false;

	return pyenvRoots.some((pyenvRoot) => {
		const shimsDir = path.join(pyenvRoot, "shims");
		const versionsDir = path.join(pyenvRoot, "versions");
		return candidate.startsWith(`${shimsDir}${path.sep}`) || candidate.startsWith(`${versionsDir}${path.sep}`);
	});
}

async function discoverVenvs(basePath: string | null, source?: PythonEnvironmentInfo["source"]): Promise<PythonEnvironmentInfo[]> {
	if (!basePath) return [];

	const results: PythonEnvironmentInfo[] = [];
	try {
		for (const entry of fs.readdirSync(basePath, {withFileTypes: true})) {
			if (!entry.isDirectory() || (!source && !entry.name.startsWith("."))) continue;

			const envDir = path.join(basePath, entry.name);
			if (!fs.existsSync(path.join(envDir, "pyvenv.cfg"))) continue;

			const result = await probeInterpreter(getVenvPythonPath(envDir), entry.name, "venv", source);
			if (result) results.push(result);
		}
	} catch {
		return [];
	}

	return results;
}

async function getWindowsInterpreterCandidates(): Promise<string[]> {
	const candidates = ["python", "python3", "py"];
	try {
		const {stdout} = await execFileAsync("py", ["-0p"], {timeout: 3000});
		for (const line of stdout.split(/\r?\n/)) {
			const match = line.match(/([a-z]:\\.*\.exe)\s*$/i);
			if (match?.[1]) candidates.push(match[1]);
		}
	} catch {
		// The standard Windows Python launcher may not be installed.
	}

	return candidates;
}

async function getGlobalInterpreterCandidates(pyenvRoots: string[]): Promise<string[]> {
	const candidates = Platform.isWin
		? await getWindowsInterpreterCandidates()
		: [
			"python3",
			"python",
			"/usr/bin/python3",
			"/usr/local/bin/python3",
			"/bin/python3",
			"/usr/bin/python",
			"/usr/local/bin/python",
			"/opt/homebrew/bin/python3",
			"/opt/homebrew/bin/python",
		];

	return Array.from(new Set([...candidates, ...getPyenvInterpreterCandidates(pyenvRoots)]));
}

async function discoverGlobalInterpreters(): Promise<PythonEnvironmentInfo[]> {
	const results: PythonEnvironmentInfo[] = [];
	const pyenvRoots = await getPyenvRoots();
	for (const candidate of await getGlobalInterpreterCandidates(pyenvRoots)) {
		const label = path.isAbsolute(candidate) ? path.basename(candidate) : candidate;
		const source = isPyenvInterpreterCandidate(candidate, pyenvRoots) ? "pyenv" : undefined;
		const result = await probeInterpreter(candidate, label, "system", source);
		if (result) results.push(result);
	}
	return results;
}

export async function getProjectPythonEnvironment(context?: NotebookExecutionContext): Promise<PythonEnvironmentInfo | null> {
	const environment = context?.environment;
	if (!environment || environment.language.toLowerCase() !== "python") return null;
	const label = environment.label ? `Project environment: ${environment.label}` : "Project environment";
	const executableDir = path.dirname(environment.executable);
	const type = fs.existsSync(path.join(path.dirname(executableDir), "pyvenv.cfg")) ? "venv" : "system";
	const result = await probeInterpreter(environment.executable, label, type, "project");
	// Keep a missing configured interpreter visible so a global fallback is never mistaken for it.
	return result ?? {label, path: environment.executable, version: "Unavailable", type, source: "project", unavailable: true};
}

export async function discoverPythonEnvironments(app: App, context?: NotebookExecutionContext): Promise<PythonEnvironmentInfo[]> {
	const [preferred, projectVenvs, venvs, globals] = await Promise.all([
		getProjectPythonEnvironment(context),
		context?.projectRoot ? discoverVenvs(context.projectRoot, "project") : Promise.resolve([]),
		discoverVenvs(getVaultBasePath(app)),
		discoverGlobalInterpreters(),
	]);
	const seen = new Set<string>();
	return [...(preferred ? [preferred] : []), ...projectVenvs, ...venvs, ...globals].filter(environment => {
		const key = Platform.isWin ? environment.path.toLowerCase() : environment.path;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
