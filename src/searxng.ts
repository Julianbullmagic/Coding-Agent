import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';

const SECRET_KEY = 'codingAgent.searxngSecret';
const DEFAULT_SEARXNG_URL = 'http://localhost:8080';

function isBundledLocalInstance(baseUrl: string): boolean {
    try {
        const url = new URL(baseUrl);
        const localHosts = ['localhost', '127.0.0.1', '[::1]'];
        return ['http:', 'https:'].includes(url.protocol)
            && localHosts.includes(url.hostname.toLowerCase())
            && (url.port === '' || url.port === '8080')
            && (url.pathname === '/' || url.pathname === '')
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

function isResponding(url: URL): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const endpoint = new URL('/', url);
        const onResponse = (response: http.IncomingMessage) => {
            response.resume();
            // Only treat 2xx/3xx/4xx as "responding". A 5xx means the server
            // is configured but not actually serving, which should read as
            // "not ready" so we keep waiting / report accurately.
            resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500);
        };
        const request = endpoint.protocol === 'https:'
            ? https.get(endpoint, onResponse)
            : http.get(endpoint, onResponse);
        request.setTimeout(1500, () => request.destroy(new Error('SearXNG health check timed out.')));
        request.on('error', () => resolve(false));
    });
}

function getDockerCli(): string {
    if (process.platform === 'win32') {
        const candidates = [
            process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
            process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Docker', 'resources', 'bin', 'docker.exe'),
        ].filter((candidate): candidate is string => Boolean(candidate));
        const installedCli = candidates.find(existsSync);
        if (installedCli) {
            return installedCli;
        }
    }
    return 'docker';
}

function runDockerCommand(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const dockerProcess = spawn(
            getDockerCli(),
            args,
            {
                env,
                stdio: ['ignore', 'ignore', 'pipe'],
                windowsHide: true,
            },
        );
        let errorOutput = '';
        dockerProcess.stderr?.on('data', (chunk: Buffer | string) => {
            errorOutput += chunk.toString();
            errorOutput = errorOutput.slice(-4000);
        });
        dockerProcess.once('error', (error) => {
            reject(new Error(`Could not run Docker: ${error.message}`));
        });
        dockerProcess.once('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                const details = errorOutput.trim();
                reject(new Error(details || `Docker exited with code ${code ?? 'unknown'}.`));
            }
        });
    });
}

function getDockerDesktopPath(): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }
    const candidates = [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Docker', 'Docker', 'Docker Desktop.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Docker', 'Docker', 'Docker Desktop.exe'),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find(existsSync);
}

function launchDockerDesktop(executable: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const desktop = spawn(executable, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        desktop.once('error', (error) => reject(new Error(`Could not launch Docker Desktop: ${error.message}`)));
        desktop.once('spawn', () => {
            desktop.unref();
            resolve();
        });
    });
}

async function installDockerDesktop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const installer = spawn('winget', [
            'install', '--id', 'Docker.DockerDesktop', '--exact',
            '--accept-package-agreements', '--accept-source-agreements', '--silent',
        ], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        });
        let errorOutput = '';
        installer.stderr?.on('data', (chunk: Buffer | string) => {
            errorOutput += chunk.toString();
            errorOutput = errorOutput.slice(-4000);
        });
        installer.once('error', (error) => reject(new Error(`Could not launch Docker Desktop installer: ${error.message}`)));
        installer.once('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(errorOutput.trim() || `Docker Desktop installation exited with code ${code ?? 'unknown'}.`));
            }
        });
    });
}

async function ensureDockerEngine(): Promise<void> {
    try {
        await runDockerCommand(['info', '--format', '{{.ServerVersion}}']);
        return;
    } catch {
        if (process.platform !== 'win32') {
            throw new Error('Docker is not running. Start Docker Engine, then reload the extension.');
        }
    }

    let desktopPath = getDockerDesktopPath();
    if (!desktopPath && vscode.workspace.getConfiguration('codingAgent').get<boolean>('autoInstallDocker', true)) {
        await installDockerDesktop();
        for (let attempt = 0; attempt < 120; attempt += 1) {
            desktopPath = getDockerDesktopPath();
            if (desktopPath) {
                break;
            }
            await delay(1000);
        }
    }
    if (!desktopPath) {
        throw new Error('Docker Desktop was not found after installation. Windows may need a restart before Docker can start.');
    }
    await launchDockerDesktop(desktopPath);

    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            await runDockerCommand(['info', '--format', '{{.ServerVersion}}']);
            return;
        } catch {
            await delay(1000);
        }
    }
    throw new Error('Docker Desktop started but the Docker engine did not become ready within 120 seconds.');
}

async function runDockerCompose(extensionPath: string, secret: string): Promise<void> {
    const composeFile = path.join(extensionPath, 'docker-compose.yml');
    const composeEnv = { ...process.env, SEARXNG_SECRET: secret };

    // Prefer the modern `docker compose` plugin. If it is absent (older
    // installs), fall back to the legacy standalone `docker-compose` binary.
    try {
        await runDockerCommand(['compose', '-f', composeFile, 'up', '-d'], composeEnv);
        return;
    } catch (pluginError) {
        const pluginDetail = pluginError instanceof Error ? pluginError.message : String(pluginError);
        const pluginMissing = /is not a docker command|unknown command|Unknown command|cannot find|not found/i.test(pluginDetail);
        if (!pluginMissing) {
            throw pluginError;
        }
    }

    try {
        await runDockerCommand(['-f', composeFile, 'up', '-d'], {
            ...composeEnv,
        });
    } catch (legacyError) {
        // Rewrite the legacy invocation as docker-compose for the final attempt.
        await runDockerComposeBinary(composeFile, secret, legacyError);
    }
}

async function runDockerComposeBinary(composeFile: string, secret: string, legacyError: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const proc = spawn('docker-compose', ['-f', composeFile, 'up', '-d'], {
            env: { ...process.env, SEARXNG_SECRET: secret },
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        });
        let errorOutput = '';
        proc.stderr?.on('data', (chunk: Buffer | string) => {
            errorOutput += chunk.toString();
            errorOutput = errorOutput.slice(-4000);
        });
        proc.once('error', () => {
            const detail = legacyError instanceof Error ? legacyError.message : String(legacyError);
            reject(new Error(`Neither 'docker compose' nor 'docker-compose' is available. ${detail}`));
        });
        proc.once('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                const detail = legacyError instanceof Error ? legacyError.message : String(legacyError);
                reject(new Error(errorOutput.trim() || detail || `docker-compose exited with code ${code ?? 'unknown'}.`));
            }
        });
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Starts Docker Desktop on Windows when needed, then starts the bundled SearXNG service. */
export async function ensureLocalSearxng(
    context: vscode.ExtensionContext,
    baseUrl: string = DEFAULT_SEARXNG_URL,
): Promise<boolean> {
    const enabled = vscode.workspace.getConfiguration('codingAgent').get<boolean>('autoStartSearxng', true);
    if (!enabled || !isBundledLocalInstance(baseUrl)) {
        return false;
    }

    const serviceUrl = new URL(baseUrl);
    if (await isResponding(serviceUrl)) {
        return false;
    }

    let secret = await context.secrets.get(SECRET_KEY);
    if (!secret) {
        secret = randomBytes(32).toString('hex');
        await context.secrets.store(SECRET_KEY, secret);
    }

    await ensureDockerEngine();
    await runDockerCompose(context.extensionPath, secret);
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (await isResponding(serviceUrl)) {
            return true;
        }
        await delay(1000);
    }
    throw new Error('SearXNG container started but did not become ready within 60 seconds.');
}
