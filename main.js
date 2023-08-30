import {ShiftableByteArray} from "./spessasynthlib/utils/shiftable_array.js";
import {MIDI} from "./spessasynthlib/midi_parser/midi_loader.js";
import {Sequencer} from "./spessasynthlib/sequencer/sequencer.js";
import {SequencerUI} from "./website/ui/sequencer_ui.js";

document.getElementById("synth_select").onchange = () => {
    document.getElementById("synth").src = document.getElementById("synth_select").value;
}

const midIn = document.getElementById("mid_in");
midIn.onchange = async () => {
    if(!midIn.files[0])
    {
        return;
    }
    midIn.parentElement.style.display = "none";
    const mid = new ShiftableByteArray(await midIn.files[0].arrayBuffer());
    const parsed = new MIDI(mid);
    document.getElementById("title").innerText = parsed.midiName;
    const synth = document.getElementById("synth")
    const seq = new Sequencer(parsed, synth.contentWindow);
    const seqUi = new SequencerUI();
    seqUi.connectSequencer(seq);
    seq.play();
}