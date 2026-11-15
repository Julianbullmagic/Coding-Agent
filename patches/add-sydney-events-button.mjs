// Adds a "Sydney events" button to the News tab that enqueues a prompt asking
// the agent to browse upcoming activist events in Sydney.
import fs from 'fs';

const path = 'src/extension.ts';
let src = fs.readFileSync(path, 'utf8');
let changed = 0;
const apply = (name, find, replace) => {
    if (!src.includes(find)) {
        console.error(`NO MATCH: ${name}`);
        process.exit(1);
    }
    src = src.replace(find, replace);
    changed++;
};

// 1. Handle the new webview message type.
apply(
    'message handler',
    `            } else if (message.type === 'injectNews') {
                await this.injectNews(view);
            } else if (message.type === 'getNewsSources') {`,
    `            } else if (message.type === 'injectNews') {
                await this.injectNews(view);
            } else if (message.type === 'browseSydneyEvents') {
                await this.browseSydneyEvents(view);
            } else if (message.type === 'getNewsSources') {`,
);

// 2. Add the method after injectNews (before postState).
apply(
    'browseSydneyEvents method',
    `    private postState(view: vscode.WebviewView, loading = false): void {`,
    `    // Enqueue a prompt asking the agent to browse upcoming activist events in
    // Sydney across a range of organisers (Socialist Alliance, Greens, Action
    // for Public Housing, unions, solidarity groups, etc.).
    private async browseSydneyEvents(view: vscode.WebviewView): Promise<void> {
        const today = new Date().toISOString().slice(0, 10);
        const prompt = [
            'Please search the web and browse for upcoming activist and community events in Sydney, Australia, from today (' + today + ') onwards.',
            'Cover as many of these organisers as you can, plus anything else you find:',
            '- Socialist Alliance / Green Left events (e.g. greenleft.org.au events listings)',
            '- The Greens NSW events pages',
            '- Action for Public Housing',
            '- Union rallies and stop-work actions (e.g. NSW unions, Rising Tide, climate groups)',
            '- Palestine, First Nations justice, refugee and climate solidarity groups',
            '- Independent event calendars (e.g. activist event listing sites, Facebook public event pages, What\\'s On pages)',
            'For each event, give: date/time, location, organiser, a one-line description, and a source link.',
            'Group events by date and note any recurring weekly meetings. Finish with links where I can find future listings myself.',
        ].join('\\n');
        await this.enqueue(view, prompt);
    }

    private postState(view: vscode.WebviewView, loading = false): void {`,
);

// 3. Add the button to the News tab header, next to "Inject news".
apply(
    'news header buttons',
    `<div class="news-head"><span class="news-title">News sources</span><button class="queue-action" id="injectNews">Inject news</button></div>`,
    `<div class="news-head"><span class="news-title">News sources</span><button class="queue-action" id="sydneyEvents">Sydney events</button><button class="queue-action" id="injectNews">Inject news</button></div>`,
);

// 4. Wire the button in the webview script.
apply(
    'webview wiring',
    `injectNewsBtn=document.getElementById('injectNews')`,
    `injectNewsBtn=document.getElementById('injectNews'),sydneyEventsBtn=document.getElementById('sydneyEvents')`,
);
apply(
    'webview click handler',
    `injectNewsBtn.onclick=()=>{vscode.postMessage({type:'injectNews'});selectTab('chat')};`,
    `injectNewsBtn.onclick=()=>{vscode.postMessage({type:'injectNews'});selectTab('chat')};sydneyEventsBtn.onclick=()=>{vscode.postMessage({type:'browseSydneyEvents'});selectTab('chat')};`,
);

fs.writeFileSync(path, src);
console.log(`OK: applied ${changed} edits`);
