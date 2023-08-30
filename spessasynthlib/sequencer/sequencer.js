import {MIDI} from "../midi_parser/midi_loader.js";
import {getEvent, messageTypes, MidiMessage} from "../midi_parser/midi_message.js";
import { consoleColors, formatTime } from '../utils/other.js'
import {readBytesAsUintBigEndian} from "../utils/byte_functions.js";

export class Sequencer {
    /**
     * Creates a new Midi sequencer for playing back MIDI file
     * @param parsedMidi {MIDI} The parsed midi
     * @param synth {WindowProxy}
     */
    constructor(parsedMidi, synth)
    {
        this.ignoreEvents = false;
        this.midiData = parsedMidi;
        this.synth = synth;

        if (!this.midiData.tracks) {
            throw "No tracks supplied!";
        }

        // event's number in this.events
        this.eventIndex = 0;

        this.oneTickToSeconds = 60 / (120 * this.midiData.timeDivision)

        // tracks the time that we have already played
        this.playedTime = 0;

        /**
         * The (relative) time when the sequencer was paused. If it's not paused then it's undefined.
         * @type {number}
         */
        this.pausedTime = 0;

        /**
         * Absolute playback startTime, bases on the synth's time
         * @type {number}
         */
        this.absoluteStartTime = (performance.now() / 1000);

        /**
         * Controls the playback's rate
         * @type {number}
         */
        this.playbackRate = 1;

        /**
         * Currently playing notes (for pausing and resuming)
         * @type {{
         *     midiNote: number,
         *     channel: number,
         *     velocity: number
         * }[]}
         */
        this.playingNotes = [];

        // controls if the sequencer loops (defaults to true)
        this.loop = true;

        this.noteOnsPerS = 0;

        /**
         * merge the tracks
         * @type {MidiMessage[]}
         */
        this.events = this.midiData.tracks.flat();
        this.events.sort((e1, e2) => e1.ticks - e2.ticks);

        /**
         * Same as Audio.duration (seconds)
         * @type {number}
         */
        this.duration =this.ticksToSeconds(this.events[this.events.length - 1].ticks);

        console.log(`TOTAL TIME: ${formatTime(Math.round(this.duration)).time}`);
    }

    /**
     * @returns {number} Current playback time, in seconds
     */
    get currentTime()
    {
        // return the paused time if it's set to something other than undefined
        if(this.pausedTime)
        {
            return this.pausedTime;
        }
        return ((performance.now() / 1000) - this.absoluteStartTime) * this.playbackRate;
    }

    set currentTime(time)
    {
        if(this.onTimeChange)
        {
            this.onTimeChange(time);
        }
        if(time < 0 || time > this.duration)
        {
            time = 0;
        }
        this.stop();
        this.playingNotes = [];
        this.pausedTime = undefined;
        this._playTo(time);
        this.absoluteStartTime = (performance.now() / 1000) - time / this.playbackRate;
        this.play();
    }

    /**
     * @param event {Array<number>}
     */
    midiEventToWML(event)
    {
        const data = 'midi,' + event.map(n => n.toString(16)).join(",");
        this.synth.postMessage(data, "*");
    }

    /**
     * Pauses the playback
     */
    pause()
    {
        if(this.paused)
        {
            console.warn("Already paused");
            return;
        }
        this.pausedTime = this.currentTime;
        this.stop();
    }

    /**
     * Coverts ticks to time in seconds
     * @param ticks {number}
     * @returns {number}
     */
    ticksToSeconds(ticks) {
        if (ticks <= 0) {
            return 0;
        }

        // find the last tempo change that has occured
        let tempo = this.midiData.tempoChanges.find(v => v.ticks < ticks);

        let timeSinceLastTempo = ticks - tempo.ticks;
        return this.ticksToSeconds(ticks - timeSinceLastTempo) + (timeSinceLastTempo * 60) / (tempo.tempo * this.midiData.timeDivision);
    }

    /**
     * true if paused, false if playing or stopped
     * @returns {boolean}
     */
    get paused()
    {
        return this.pausedTime !== undefined;
    }

    /**
     * plays from start to the target time, excluding note messages (to get the synth to the correct state)
     * @private
     * @param time {number} in seconds
     * @param ticks {number} optional MIDI ticks, when given is used instead of time
     */
    _playTo(time, ticks = undefined)
    {
        this.playedTime = 0;
        this.eventIndex = 0;
        this.oneTickToSeconds = 60 / (120 * this.midiData.timeDivision);
        // process every non note message from the start
        for (let i = 0; i < 16; i++) {
            this.midiEventToWML([messageTypes.controllerChange | i.toString(16), 0x78, 0]) // all notes off
            this.midiEventToWML([messageTypes.controllerChange | i.toString(16), 0x7b, 0]) // all sound off
        }
        // optimize to call pitchwheels 16 times only
        const pitches = new Uint16Array(16);

        // optimize program changes to call 16 times only
        const programs = new Uint8Array(16);

        for(let i = 0; i < 16; i++)
        {
            pitches[i] = 8192;
        }
        let event = this.events[this.eventIndex];
        while(true) {
            const type = event.messageStatusByte >> 4;
            const channel = event.messageStatusByte & 0x0F;
            if (type === 0x8 || type === 0x9) {
                this.eventIndex++;
                this.playedTime += this.oneTickToSeconds * (this.events[this.eventIndex].ticks - event.ticks);
                event = this.events[this.eventIndex];
            }
            else
            // pitch wheel
            if(type === 0xE)
            {
                pitches[channel] = (event.messageData[1] << 7 ) | event.messageData[0];
                this.eventIndex++;
                this.playedTime += this.oneTickToSeconds * (this.events[this.eventIndex].ticks - event.ticks);
                event = this.events[this.eventIndex];
            }
            else
            // program change
            if(type === 0xC)
            {
                programs[channel] = event.messageData[0];
                this.eventIndex++;
                this.playedTime += this.oneTickToSeconds * (this.events[this.eventIndex].ticks - event.ticks);
                event = this.events[this.eventIndex];
            }
            else {
                this._processEvent(event);

                this.eventIndex++;
                this.playedTime += this.oneTickToSeconds * (this.events[this.eventIndex].ticks - event.ticks);
                event = this.events[this.eventIndex];
            }

            if(ticks !== undefined)
            {
                if(event.ticks >= ticks)
                {
                    break;
                }
            }
            else
            {
                if(this.playedTime >= time)
                {
                    break;
                }
            }
        }

        for(let i = 0; i < 16; i++)
        {
            this.midiEventToWML([messageTypes.pitchBend | i, pitches[i] & 0x7F, pitches[i] >> 7]);
            this.midiEventToWML([messageTypes.programChange | i, programs[i]]);
        }
    }

    /**
     * Starts the playback
     * @param resetTime {boolean} If true, time is set to 0s
     */
    play(resetTime = false)
    {

        // reset the time if necesarry
        if(resetTime) {
            this.currentTime = 0;
            return;
        }

        if(this.currentTime >= this.duration)
        {
            this.currentTime = 0;
            return;
        }

        // unpause if paused
        if(this.paused)
        {
            // adjust the start time
            this.absoluteStartTime = performance.now() / 1000 - this.pausedTime;
            this.pausedTime = undefined;
        }

        this.playingNotes.forEach(n => {
            this.midiEventToWML([messageTypes.noteOn | n.channel, n.midiNote, n.velocity]);
        });

        this.playbackInterval = setInterval(this._processTick.bind(this));
        this.noteCounterClearInterval = setInterval( () =>this.noteOnsPerS = 0, 100);
    }

    setTimeTicks(ticks)
    {
        this.stop();
        this.playingNotes = [];
        this.pausedTime = undefined;
        this._playTo(0, ticks);
        this.absoluteStartTime = (performance.now() / 1000) - this.playedTime / this.playbackRate;
        this.play();
        if(this.onTimeChange)
        {
            this.onTimeChange(this.currentTime);
        }
    }

    /**
     * Processes a single tick
     * @private
     */
    _processTick()
    {
        if(this.eventIndex >= this.events.length)
        {
            this.pause();
            return;
        }
        let event = this.events[this.eventIndex];
        while(this.playedTime <= this.currentTime)
        {
            this._processEvent(event);
            ++this.eventIndex;

            // loop
            if((this.eventIndex >= this.events.length || this.midiData.loop.end <= event.ticks) && this.loop)
            {
                this.setTimeTicks(this.midiData.loop.start);
                return;
            }

            if(this.eventIndex >= this.events.length)
            {
                this.pause();
                return;
            }

            this.playedTime += this.oneTickToSeconds * (this.events[this.eventIndex].ticks - event.ticks);
            event = this.events[this.eventIndex];
        }
    }

    /**
     * gets tempo from the midi message
     * @param event {MidiMessage}
     * @return {number} the tempo in bpm
     */
    getTempo(event)
    {
        event.messageData.currentIndex = 0;
        return 60000000 / readBytesAsUintBigEndian(event.messageData, 3);
    }

    /**
     * Processes a single event
     * @param event {MidiMessage}
     * @private
     */
    _processEvent(event)
    {
        if(this.ignoreEvents) return;
            if(event.messageStatusByte >= 0x80) {
                this.midiEventToWML([event.messageStatusByte, ...event.messageData]);
                return;
            }
        const statusByteData = getEvent(event.messageStatusByte);
        // process the event
        switch (statusByteData.status) {
            case messageTypes.setTempo:
                this.oneTickToSeconds = 60 / (this.getTempo(event) * this.midiData.timeDivision);
                if(this.oneTickToSeconds === 0)
                {
                    this.oneTickToSeconds = 60 / (120 * this.midiData.timeDivision);
                    console.warn("invalid tempo! falling back to 120 BPM");
                }
                break;

            case messageTypes.endOfTrack:
            case messageTypes.midiChannelPrefix:
            case messageTypes.timeSignature:
            case messageTypes.songPosition:
            case messageTypes.activeSensing:
            case messageTypes.keySignature:
            case messageTypes.midiPort:
                break;

            default:
                console.log(`%cUnrecognized Event: %c${event.messageStatusByte}%c status byte: %c${Object.keys(messageTypes).find(k => messageTypes[k] === statusByteData.status)}`,
                    consoleColors.warn,
                    consoleColors.unrecognized,
                    consoleColors.warn,
                    consoleColors.value);
                break;

            case messageTypes.text:
            case messageTypes.lyric:
            case messageTypes.copyright:
            case messageTypes.trackName:
            case messageTypes.marker:
            case messageTypes.cuePoint:
            case messageTypes.instrumentName:
                if(this.onTextEvent)
                {
                    this.onTextEvent(event.messageData, statusByteData.status);
                }
                break;
        }
    }


    /**
     * Stops the playback
     */
    stop()
    {
        clearInterval(this.playbackInterval);
        this.playbackInterval = undefined;
        for (let c = 0; c < 16; c++)
        {
            this.midiEventToWML([messageTypes.controllerChange | c, 120, 0]); // all notes off
            this.midiEventToWML([messageTypes.controllerChange | c, 123, 0]) // all sound off
        }
    }

    /**
     * Fires on text event
     * @param data {ShiftableByteArray} the data text
     * @param type {number} the status byte of the message (the meta status byte)
     */
    onTextEvent;

    /**
     * Fires when CurrentTime changes
     * @param time {number} the time that was changed to
     */
    onTimeChange;
}