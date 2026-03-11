/**
 * GLOBAL SOUND MANAGER
 * Handles ambient music, sound effects, and volume controls for the Casino.
 * Implements AudioContext for low-latency playback.
 */
class SoundManager {
    constructor() {
        this.ctx = null;
        this.initialized = false;

        this.masterVolume = { bg: 0.3, sfx: 0.6 };
        this.gainNodes = {};
        this.buffers = {};

        // Control concurrency and spam
        this.lastPlayTime = {};
        this.activeNodes = [];

        // Library definitions
        this.library = {
            bgm_moche: { src: '/static/audio/bgm_moche.mp3', type: 'bg' },
            bgm_slot: { src: '/static/audio/bgm_slot.mp3', type: 'bg' },
            btn_click: { src: '/static/audio/btn_click.mp3', type: 'sfx' },
            chip_drop: { src: '/static/audio/chip_drop.mp3', type: 'sfx' },
            card_slide: { src: '/static/audio/card_slide.mp3', type: 'sfx' },
            win_normal: { src: '/static/audio/win_normal.mp3', type: 'sfx' },
            win_big: { src: '/static/audio/win_big.mp3', type: 'sfx' },
            lose: { src: '/static/audio/lose.mp3', type: 'sfx' },
            absorb: { src: '/static/audio/absorb.mp3', type: 'sfx' },
            slot_reel: { src: '/static/audio/slot_reel.mp3', type: 'sfx' },
            slot_coin: { src: '/static/audio/slot_coin.mp3', type: 'sfx' },
            roulette_spin: { src: '/static/audio/roulette_spin.mp3', type: 'sfx' },
            roulette_stop: { src: '/static/audio/roulette_stop.mp3', type: 'sfx' }
        };

        // UI Events to initialize context
        const initAudio = () => {
            this.initAudioContext();
            document.removeEventListener('pointerdown', initAudio);
            document.removeEventListener('keydown', initAudio);
        };
        document.addEventListener('pointerdown', initAudio);
        document.addEventListener('keydown', initAudio);
    }

    initAudioContext() {
        if (this.initialized) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        this.gainNodes.bg = this.ctx.createGain();
        this.gainNodes.bg.gain.value = this.masterVolume.bg;
        this.gainNodes.bg.connect(this.ctx.destination);

        this.gainNodes.sfx = this.ctx.createGain();
        this.gainNodes.sfx.gain.value = this.masterVolume.sfx;
        this.gainNodes.sfx.connect(this.ctx.destination);

        this.initialized = true;
        console.log("AudioContext Initialized for Luxury Casino.");

        // Attempt to load sounds, else use synth fallback
        this.preloadLibrary();
    }

    async preloadLibrary() {
        for (const [id, data] of Object.entries(this.library)) {
            try {
                const response = await fetch(data.src);
                if (!response.ok) throw new Error('Not found');
                const arrayBuffer = await response.arrayBuffer();
                this.buffers[id] = await this.ctx.decodeAudioData(arrayBuffer);
            } catch (e) {
                // Silently fallback if file doesn't exist
                this.buffers[id] = 'synth';
            }
        }
    }

    playSfx(id, options = {}) {
        if (!this.initialized || !this.ctx) return;

        const now = this.ctx.currentTime;

        // Debounce: Prevenir saturación si el mismo sonido se dispara en menos de 50ms
        if (this.lastPlayTime[id] && (now - this.lastPlayTime[id] < 0.05)) {
            return;
        }
        this.lastPlayTime[id] = now;

        const buffer = this.buffers[id];
        let duration = 0.5;

        if (buffer && buffer !== 'synth') {
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;

            // Per-sound gain for volume tweaking
            const localGain = this.ctx.createGain();
            localGain.gain.value = options.volume || 1.0;

            source.connect(localGain);
            localGain.connect(this.gainNodes.sfx);

            source.start(0);
            duration = buffer.duration;
            this.activeNodes.push(source);
        } else {
            // SYNTH FALLBACK: Generate procedural sounds if files are missing
            this._playSynthFallback(id, options.volume || 1.0);
        }

        // Ducking (atenuación de bgm) para premios grandes
        if (id === 'win_big' || id === 'win_massive' || id === 'win_normal') {
            const bgGain = this.gainNodes.bg.gain;
            bgGain.cancelScheduledValues(now);
            bgGain.setValueAtTime(this.masterVolume.bg, now);
            bgGain.linearRampToValueAtTime(0.05, now + 0.2); // Duck to 5%
            bgGain.linearRampToValueAtTime(this.masterVolume.bg, now + duration + 0.5); // Restore after sound
        }
    }

    playBGM(id) {
        if (!this.initialized || !this.ctx) return;
        // Stop current BGM
        if (this.currentBGMNode) {
            this.currentBGMNode.stop();
            this.currentBGMNode = null;
        }

        const buffer = this.buffers[id];
        if (buffer && buffer !== 'synth') {
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(this.gainNodes.bg);
            source.start(0);
            this.currentBGMNode = source;
        } else {
            console.log(`BGM ${id} not found. Silence playing.`);
        }
    }

    setMute(isMuted) {
        if (!this.ctx) return;
        const targetVolBG = isMuted ? 0 : this.masterVolume.bg;
        const targetVolSFX = isMuted ? 0 : this.masterVolume.sfx;

        this.gainNodes.bg.gain.linearRampToValueAtTime(targetVolBG, this.ctx.currentTime + 0.3);
        this.gainNodes.sfx.gain.linearRampToValueAtTime(targetVolSFX, this.ctx.currentTime + 0.3);
    }

    // --- PROCEDURAL SYNTHESIZER FALLBACKS ---
    _playSynthFallback(id, volModifier) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;

        osc.connect(gain);
        gain.connect(this.gainNodes.sfx);

        let type = 'sine';
        let freq = 440;
        let decay = 0.5;

        switch (id) {
            case 'btn_click':
                type = 'square'; freq = 600; decay = 0.1;
                gain.gain.setValueAtTime(0.1 * volModifier, now);
                break;
            case 'chip_drop':
                type = 'triangle'; freq = 800; decay = 0.15;
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
                gain.gain.setValueAtTime(0.3 * volModifier, now);
                break;
            case 'card_slide':
                type = 'sawtooth'; freq = 200; decay = 0.2; // simulate paper
                gain.gain.setValueAtTime(0.05 * volModifier, now);
                break;
            case 'win_normal':
                type = 'sine'; freq = 400; decay = 1.0;
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.setValueAtTime(600, now + 0.2);
                osc.frequency.setValueAtTime(800, now + 0.4);
                gain.gain.setValueAtTime(0.4 * volModifier, now);
                break;
            case 'win_big':
                type = 'square'; freq = 300; decay = 2.0;
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.setValueAtTime(450, now + 0.3);
                osc.frequency.setValueAtTime(600, now + 0.6);
                osc.frequency.setValueAtTime(900, now + 0.9);
                gain.gain.setValueAtTime(0.5 * volModifier, now);
                break;
            case 'lose':
                type = 'sawtooth'; freq = 300; decay = 0.6;
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
                gain.gain.setValueAtTime(0.2 * volModifier, now);
                break;
            case 'slot_reel':
                type = 'square'; freq = 100; decay = 0.1; // mechanical click
                gain.gain.setValueAtTime(0.1 * volModifier, now);
                break;
            case 'slot_coin':
                type = 'triangle'; freq = 1200; decay = 0.2; // metal ting
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
                gain.gain.setValueAtTime(0.2 * volModifier, now);
                break;
            case 'absorb':
                type = 'sine'; freq = 500; decay = 0.4;
                osc.frequency.linearRampToValueAtTime(1000, now + 0.3);
                gain.gain.setValueAtTime(0.3 * volModifier, now);
                break;
            default:
                type = 'sine'; freq = 440; decay = 0.2;
                gain.gain.setValueAtTime(0.1 * volModifier, now);
        }

        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        osc.start(now);
        osc.stop(now + decay);
    }
}

window.CasinoAudio = new SoundManager();

// Setup global button SFX
document.addEventListener("DOMContentLoaded", () => {
    document.body.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.btn, button, a, .bet-btn-circle')) {
            window.CasinoAudio.playSfx('btn_click');
        }
    }, true);
});
