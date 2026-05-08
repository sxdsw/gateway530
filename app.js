const CUE_MAP = {
  '*': { type: 'pause',     duration: 500 },
  '%': { type: 'clear'                     },
  '^': { type: 'clear_stop'                },
  '@': { type: 'flicker_out'               },
  '$': { type: 'interrupt'                 },
  '#': { type: 'immediate'                 },
  '~': { type: 'newline'                   },
};

// ── Intro flash ───────────────────────────────────────────────────────────────

const flash = document.getElementById('flash-screen');
let visible = true;

document.body.classList.add('intro-active');

const blinkInterval = setInterval(() => {
  flash.classList.toggle('visible');
  visible = !visible;
}, 100);

setTimeout(() => {
  clearInterval(blinkInterval);
  flash.classList.add('hide');
  document.body.classList.remove('intro-active');
  startConversation();
}, 800);

// ── Parser ────────────────────────────────────────────────────────────────────

function parseCues(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (CUE_MAP[ch]) {
      tokens.push({ ...CUE_MAP[ch] });
      i += 1;
    } else {
      tokens.push({ type: 'char', value: ch });
      i++;
    }
  }
  return tokens;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const wait = ms => new Promise(res => setTimeout(res, ms));

const activeControllers = { A: null, B: null };

// Render the source string to innerHTML, converting \n → <br>
function render(textEl, displayed) {
  textEl.innerHTML = displayed.replace(/\n/g, '<br>');
}

async function flickerOut(textEl) {
  textEl.classList.add('flicker-out');
  await wait(500);
  textEl.innerHTML = '';
  textEl.classList.remove('flicker-out');
}

// ── Token executor ────────────────────────────────────────────────────────────

async function typeTokens(tokens, speaker, container) {
  container.innerHTML = '';

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${speaker.toLowerCase()}`;
  bubble.innerHTML = `<span class="prompt">${speaker === 'A' ? '&lt;&lt;' : '&gt;&gt;'} </span><span class="typewriter-text"></span>`;      container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  const textEl = bubble.querySelector('.typewriter-text');
  const controller = new AbortController();
  activeControllers[speaker] = controller;

  const aborted = () => controller.signal.aborted;

  let displayed = '';   // single source of truth for what's on screen
  let immediate = false;
  let flickerOnExit = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (aborted()) {
      textEl.classList.remove('typing');
      return { finished: false, immediate: false };
    }

    if (token.type === 'char') {
      displayed += token.value;
      render(textEl, displayed);
      textEl.classList.add('typing');
      await wait(90);
    }

    else if (token.type === 'newline') {
      displayed += '\n';
      render(textEl, displayed);
    }

    else if (token.type === 'pause') {
      await wait(token.duration);
    }

    else if (token.type === 'clear') {
      while (displayed.length > 0) {
        if (aborted()) {
          textEl.classList.remove('typing');
          return { finished: false, immediate: false };

        }
        // ^ is next — flicker out instead of backspacing
        if (tokens[i + 1]?.type === 'clear_stop') {
          i++; // consume ^
          await flickerOut(textEl);
          displayed = '';
          break;
          
        }
        displayed = displayed.slice(0, -1);
        render(textEl, displayed);
        await wait(10);
      }
    }

    else if (token.type === 'clear_stop') {
      // ^ without preceding % — ignore
    }

    else if (token.type === 'flicker_out') {
      flickerOnExit = true;
      console.log('flicker!');
      await flickerOut(textEl);
      displayed = '';
    }

    else if (token.type === 'interrupt') {
      const other = speaker === 'A' ? 'B' : 'A';
      if (activeControllers[other]) {
        activeControllers[other].abort();
      }
      await wait(120);
    }

    else if (token.type === 'immediate') {
      immediate = true;
    }
  }

  textEl.classList.remove('typing');

  // @ — flicker out at end of line before turn passes
  if (flickerOnExit && displayed.length > 0) {
    await flickerOut(textEl);
    displayed = '';
  }

  return { finished: true, immediate };
}

// ── Conversation sequencer ────────────────────────────────────────────────────

async function runConversation(containerA, containerB, rawA, rawB) {
  const colA = containerA.parentElement;
  const colB = containerB.parentElement;

  const queueA = rawA.map(parseCues);
  const queueB = rawB.map(parseCues);
  let idxA = 0, idxB = 0;
  let current = 'A';

  while (idxA < queueA.length || idxB < queueB.length) {
    const isA = current === 'A';
    const queue     = isA ? queueA     : queueB;
    const idx       = isA ? idxA       : idxB;
    const container = isA ? containerA : containerB;

    colA.classList.toggle('active', current === 'A');
    colB.classList.toggle('active', current === 'B');

    if (idx >= queue.length) {
      current = isA ? 'B' : 'A';
      continue;
    }

    const { finished, immediate } = await typeTokens(queue[idx], current, container);

    if (isA) idxA++; else idxB++;

    if (finished) {
      if (!immediate) await wait(300);
      current = isA ? 'B' : 'A';
    }
  }

  colA.classList.remove('active');
  colB.classList.remove('active');
}

// ── Data loader ───────────────────────────────────────────────────────────────

function parseDataFile(raw) {
  return raw
    .trim()
    .split('\n')
    .map(line => {
      const match = line.match(/^index:\s*\d+,\s*message:\s*(.*)$/);
      return match ? match[1].trim() : null;
    })
    .filter(Boolean);
}

function startConversation() {
  Promise.all([
    fetch('personA.txt').then(r => r.text()),
    fetch('personB.txt').then(r => r.text()),
  ]).then(([rawA, rawB]) => {
    const containerA = document.getElementById('chat-container-1');
    const containerB = document.getElementById('chat-container-1'); // ← fixed typo
    runConversation(containerA, containerB, parseDataFile(rawA), parseDataFile(rawB));
  });
}