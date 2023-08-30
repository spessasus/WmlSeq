import {Sequencer} from "../../spessasynthlib/sequencer/sequencer.js";
import { formatTime, supportedEncodings } from '../../spessasynthlib/utils/other.js'
import { getLoopSvg, getPauseSvg, getPlaySvg, getTextSvg } from './icons.js';
import { messageTypes } from '../../spessasynthlib/midi_parser/midi_message.js'

const ICON_SIZE = 32;

const ICON_COLOR = "#ccc";
const ICON_DISABLED = "#555";

const DEFAULT_ENCODING = "Shift_JIS";

export class SequencerUI{
    /**
     * Creates a new User Interface for the given MidiSequencer
     */
    constructor() {
        this.controls = document.getElementById("sequencer_controls");
        this.encoding = DEFAULT_ENCODING;
        this.decoder = new TextDecoder(this.encoding);
        this.encoder = new TextEncoder(this.encoding);
        this.text = "";
        this.rawText = [];
    }

    /**
     *
     * @param sequencer {Sequencer} the sequencer to be used
     */
    connectSequencer(sequencer)
    {
        this.seq = sequencer;
        this.createControls();
        this.setSliderInterval();

        this.seq.onTextEvent = (data, type) => {
            let end = "";
            switch (type)
            {
                default:
                    return;

                case messageTypes.text:
                case messageTypes.copyright:
                case messageTypes.cuePoint:
                case messageTypes.trackName:
                    end = "\n";
                    break;

                case messageTypes.lyric:

                    break;
            }
            const text = this.decoder.decode(data.buffer);
            this.text += text + end;
            this.rawText.push(...data, ...this.encoder.encode(end));
            if(end === "")
            {
                // instantly append if lyrics and 100ms batches otherwise, to avoid that initial setup text spam (looking at you, touhou midis)
                this.lyricsElement.text.innerText = this.text
            }
            this.lyricsElement.mainDiv.scrollTo(0, this.lyricsElement.text.scrollHeight);
        }

        this.seq.onTimeChange = () => {
            this.text = "";
            this.rawText = [];
        }
    }

    changeEncoding(encoding)
    {
        this.encoding = encoding;
        this.decoder = new TextDecoder(encoding);
        this.text = this.decoder.decode(new Uint8Array(this.rawText).buffer);
    }

    createControls() {
        // time
        this.progressTime = document.createElement("p");
        this.progressTime.id = "note_time";
        // it'll always be on top
        this.progressTime.onclick = event => {
            event.preventDefault();
            const barPosition = progressBarBg.getBoundingClientRect();
            const x = event.clientX - barPosition.left;
            const width = barPosition.width;

            this.seq.currentTime = (x / width) * this.seq.duration;
            playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
        };

        /**
         * LYRICS
         * @type {{
         *     mainDiv: HTMLDivElement,
         *     title: HTMLHeadingElement,
         *     text: HTMLParagraphElement,
         *     selector: HTMLSelectElement
         * }}
         */
        this.lyricsElement = {};

        // main div
        const mainLyricsDiv  = document.createElement("div");
        mainLyricsDiv.classList.add("lyrics");
        // title
        const lyricsTitle = document.createElement("h2");
        lyricsTitle.innerText = "Decoded Text";
        lyricsTitle.classList.add("lyrics_title");
        mainLyricsDiv.appendChild(lyricsTitle);
        this.lyricsElement.title = lyricsTitle;
        // encoding selector
        const encodingSelector = document.createElement("select");
        supportedEncodings.forEach(encoding => {
            const option = document.createElement("option");
            option.innerText = encoding;
            option.value = encoding;
            encodingSelector.appendChild(option);
        });
        encodingSelector.value = this.encoding;
        encodingSelector.onchange = () => this.changeEncoding(encodingSelector.value);
        encodingSelector.classList.add("lyrics_selector");
        mainLyricsDiv.appendChild(encodingSelector);
        // the actual text
        const text = document.createElement("p");
        text.classList.add("lyrics_text");
        mainLyricsDiv.appendChild(text);
        this.lyricsElement.text = text;

        this.lyricsElement.mainDiv = mainLyricsDiv;

        this.controls.appendChild(mainLyricsDiv);

        setInterval(() => {
            if(this.lyricsElement.text.innerText !== this.text) this.lyricsElement.text.innerText = this.text;
        }, 100);

        // background bar
        const progressBarBg = document.createElement("div");
        progressBarBg.id = "note_progress_background";

        // foreground bar
        this.progressBar = document.createElement("div");
        this.progressBar.id = "note_progress";
        this.progressBar.min = (0).toString();
        this.progressBar.max =  this.seq.duration.toString();

        // control buttons
        const controlsDiv = document.createElement("div");

        // play pause
        const playPauseButton = document.createElement("div");
        playPauseButton.classList.add("control_buttons");
        playPauseButton.title = "Play/pause";
        playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
        const togglePlayback = () => {
            if(this.seq.paused)
            {
                this.seq.play();
                playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
            }
            else
            {
                this.seq.pause();
                playPauseButton.innerHTML = getPlaySvg(ICON_SIZE);
            }
        }
        playPauseButton.onclick = togglePlayback;

        // loop button
        const loopButton = document.createElement("div");
        loopButton.classList.add("control_buttons");
        loopButton.title = "Loop";
        loopButton.innerHTML = getLoopSvg(ICON_SIZE);
        const toggleLoop = () => {
            if(this.seq.loop)
            {
                this.seq.loop = false;
            }
            else
            {
                this.seq.loop = true;
                if(this.seq.currentTime >= this.seq.duration)
                {
                    this.seq.currentTime = 0;
                }
            }
            loopButton.firstElementChild.setAttribute("fill", (this.seq.loop ? ICON_COLOR : ICON_DISABLED));
        }
        loopButton.onclick = toggleLoop;

        // show text button
        const textButton = document.createElement("div");
        textButton.classList.add("control_buttons");
        textButton.title = "Show lyrics";
        textButton.innerHTML = getTextSvg(ICON_SIZE);
        textButton.firstElementChild.setAttribute("fill", ICON_DISABLED); // defaults to disabled
        const toggleLyrics = () => {
            this.lyricsElement.mainDiv.classList.toggle("lyrics_show");
            textButton.firstElementChild.setAttribute("fill", (this.lyricsElement.mainDiv.classList.contains("lyrics_show") ? ICON_COLOR : ICON_DISABLED));
        }
        textButton.onclick = toggleLyrics;

        // keyboard control
        document.addEventListener("keypress", event => {
            switch(event.key.toLowerCase())
            {
                case " ":
                    event.preventDefault();
                    togglePlayback();
                    break;

                case "l":
                    event.preventDefault();
                    toggleLoop();
                    break;

                case "t":
                    event.preventDefault();
                    toggleLyrics();
                    break;

                default:
                    break;
            }
        })
        controlsDiv.appendChild(playPauseButton);
        controlsDiv.appendChild(loopButton);
        controlsDiv.appendChild(textButton);

        // add everything
        this.controls.appendChild(progressBarBg);
        this.controls.appendChild(this.progressBar);
        this.controls.appendChild(this.progressTime);
        this.controls.appendChild(controlsDiv);

        // add number and arrow controls
        document.addEventListener("keydown", e => {

            if(e.key.toLowerCase() === "arrowleft")
            {
                e.preventDefault();
                this.seq.currentTime -= 5;
                playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
            }
            else if(e.key.toLowerCase() === "arrowright")
            {
                e.preventDefault();
                this.seq.currentTime += 5;
                playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
            }

            if(!isNaN(parseFloat(e.key)))
            {
                e.preventDefault();
                const num = parseInt(e.key);
                if(0 <= num && num <= 9)
                {
                    this.seq.currentTime = this.seq.duration * (num / 10);
                    playPauseButton.innerHTML = getPauseSvg(ICON_SIZE);
                }
            }
        })
    }

    setSliderInterval(){
        setInterval(() => {
            this.progressBar.style.width = `${(this.seq.currentTime / this.seq.duration) * 100}%`;
            const time = formatTime(this.seq.currentTime);
            const total = formatTime(this.seq.duration);
            this.progressTime.innerText = `${time.time} / ${total.time}`;
        }, 100);
    }
}