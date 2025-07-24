import {
  // VAD
  // AutoModel,

  // LLM
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,

  // Speech recognition
  // Tensor,
  pipeline,
} from "@huggingface/transformers";

import { KokoroTTS, TextSplitterStream } from "kokoro-js";

import {
  MAX_BUFFER_DURATION,
  INPUT_SAMPLE_RATE,
  // SPEECH_THRESHOLD,
  // EXIT_THRESHOLD,
  SPEECH_PAD_SAMPLES,
  MAX_NUM_PREV_BUFFERS,
  MIN_SILENCE_DURATION_SAMPLES,
  MIN_SPEECH_DURATION_SAMPLES,
} from "./constants";

import { RealtimeUtils } from "../utils";

const device = (typeof process !== "undefined" && process.env.DEVICE) || "webgpu";
const DEVICE_DTYPE_CONFIGS = {
  webgpu: { encoder_model: "fp32", decoder_model_merged: "fp32" },
  wasm: { encoder_model: "fp32", decoder_model_merged: "q8" },
  cpu: { encoder_model: "fp32", decoder_model_merged: "q8" },
};

// Load models
const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
const tts = await KokoroTTS.from_pretrained(model_id, { dtype: "fp32", device });

// const silero_vad = await AutoModel.from_pretrained("onnx-community/silero-vad", {
//   config: { model_type: "custom" },
//   dtype: "fp32", // Full-precision
// }).catch((error) => {
//   throw error;
// });
const transcriber = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/whisper-base", // or "onnx-community/moonshine-base-ONNX",
  { device, dtype: DEVICE_DTYPE_CONFIGS[device] },
).catch((error) => {
  throw error;
});

await transcriber(new Float32Array(INPUT_SAMPLE_RATE)); // Compile shaders

const llm_model_id = "HuggingFaceTB/SmolLM2-1.7B-Instruct";
const tokenizer = await AutoTokenizer.from_pretrained(llm_model_id);
const llm = await AutoModelForCausalLM.from_pretrained(llm_model_id, { dtype: "q4f16", device });

await llm.generate({ ...tokenizer("x"), max_new_tokens: 1 }); // Compile shaders

const sessions = {};
export const createSession = () => {
  const id = RealtimeUtils.generateId("sess_");
  sessions[id] = {
    // Global audio buffer to store incoming audio
    BUFFER: new Float32Array(MAX_BUFFER_DURATION * INPUT_SAMPLE_RATE),
    bufferPointer: 0,
    // Initial state for VAD
    // sr: new Tensor("int64", [INPUT_SAMPLE_RATE], []),
    // state: new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]),

    // Whether we are in the process of adding audio to the buffer
    isRecording: false,
    isPlaying: false, // new flag
    voice: "bm_george",
    // Track the number of samples after the last speech chunk
    postSpeechSamples: 0,

    past_key_values_cache: null,
    stopping_criteria: null,
  };
  return id;
};

export const deleteSession = (id) => {
  delete sessions[id];
};

/**
 * Perform Voice Activity Detection (VAD)
 * @param {Float32Array} buffer The new audio buffer
 * @returns {Promise<boolean>} `true` if the buffer is speech, `false` otherwise.
 */
async function vad(buffer) {
  // const input = new Tensor("float32", buffer, [1, buffer.length]);

  // const { stateN, output } = await silero_vad({ input, sr, state });
  // state = stateN; // Update state

  // const isSpeech = output.data[0];

  // // Use heuristics to determine if the buffer is speech or not
  // return (
  //   // Case 1: We are above the threshold (definitely speech)
  //   isSpeech > SPEECH_THRESHOLD ||
  //   // Case 2: We are in the process of recording, and the probability is above the negative (exit) threshold
  //   (isRecording && isSpeech >= EXIT_THRESHOLD)
  // );
  let sumOfSquares = 0;
  const numSamplesInThisBuffer = buffer.length;

  for (let i = 0; i < numSamplesInThisBuffer; i++) {
    const sample = buffer[i];
    sumOfSquares += sample * sample;
  }

  const rms = Math.sqrt(sumOfSquares / numSamplesInThisBuffer);
  if (rms === 0) {
    return -Infinity;
  }

  return 20 * Math.log10(rms) > -50; // dB
}

/**
 * Transcribe the audio buffer
 * @param {Float32Array} buffer The audio buffer
 * @param {Object} data Additional data
 */
const speechToText = async (buffer, data) => {
  // isPlaying = true;

  // 1. Transcribe the audio from the user
  const text = await transcriber(buffer).then(({ text }) => text.trim());
  console.log("STT:", text);
  if (["", "[BLANK_AUDIO]"].includes(text)) {
    // If the transcription is empty or a blank audio, we skip the rest of the processing
    return "";
  }
  return text;
};

const resetAfterRecording = (session, offset = 0) => {
  session.BUFFER.fill(0, offset);
  session.bufferPointer = offset;
  session.isRecording = false;
  session.postSpeechSamples = 0;
};

const dispatchForTranscriptionAndResetAudioBuffer = (session, overflow) => {
  // Get start and end time of the speech segment, minus the padding
  const now = Date.now();
  const end = now - ((session.postSpeechSamples + SPEECH_PAD_SAMPLES) / INPUT_SAMPLE_RATE) * 1000;
  const start = end - (session.bufferPointer / INPUT_SAMPLE_RATE) * 1000;
  const duration = end - start;
  const overflowLength = overflow?.length ?? 0;

  // Send the audio buffer to the worker
  const buffer = session.BUFFER.slice(0, session.bufferPointer + SPEECH_PAD_SAMPLES);

  const prevLength = prevBuffers.reduce((acc, b) => acc + b.length, 0);
  const paddedBuffer = new Float32Array(prevLength + buffer.length);
  let offset = 0;
  for (const prev of prevBuffers) {
    paddedBuffer.set(prev, offset);
    offset += prev.length;
  }
  paddedBuffer.set(buffer, offset);
  const text = speechToText(paddedBuffer, { start, end, duration });

  // Set overflow (if present) and reset the rest of the audio buffer
  if (overflow) {
    session.BUFFER.set(overflow, 0);
  }
  resetAfterRecording(session, overflowLength);

  return text;
};

let prevBuffers = [];
const transcribe = async (id, buffer, cb) => {
  const session = sessions[id];
  // refuse new audio while playing back
  if (session.isPlaying) return;

  const wasRecording = session.isRecording; // Save current state
  const isSpeech = await vad(buffer);
  if (!wasRecording && !isSpeech) {
    // We are not recording, and the buffer is not speech,
    // so we will probably discard the buffer. So, we insert
    // into a FIFO queue with maximum size of PREV_BUFFER_SIZE
    if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) {
      // If the queue is full, we discard the oldest buffer
      prevBuffers.shift();
    }
    prevBuffers.push(buffer);
    return;
  }

  const remaining = session.BUFFER.length - session.bufferPointer;
  if (buffer.length >= remaining) {
    // The buffer is larger than (or equal to) the remaining space in the global buffer,
    // so we perform transcription and copy the overflow to the global buffer
    session.BUFFER.set(buffer.subarray(0, remaining), session.bufferPointer);
    session.bufferPointer += remaining;

    // Dispatch the audio buffer
    const overflow = buffer.subarray(remaining);
    return dispatchForTranscriptionAndResetAudioBuffer(session, overflow);
  } else {
    // The buffer is smaller than the remaining space in the global buffer,
    // so we copy it to the global buffer
    session.BUFFER.set(buffer, session.bufferPointer);
    session.bufferPointer += buffer.length;
  }

  if (isSpeech) {
    if (!session.isRecording) {
      // Indicate start of recording
      session.isRecording = true;
      cb({ type: "status", status: "recording_start", message: "Listening...", duration: "until_next" });
      session.postSpeechSamples = 0; // Reset the post-speech samples
      return;
    }
  }

  session.postSpeechSamples += buffer.length;

  // At this point we're confident that we were recording (wasRecording === true), but the latest buffer is not speech.
  // So, we check whether we have reached the end of the current audio chunk.
  if (session.postSpeechSamples < MIN_SILENCE_DURATION_SAMPLES) {
    // There was a short pause, but not long enough to consider the end of a speech chunk
    // (e.g., the speaker took a breath), so we continue recording
    return;
  }

  if (session.bufferPointer >= MIN_SPEECH_DURATION_SAMPLES) {
    return dispatchForTranscriptionAndResetAudioBuffer(session);
  }
};

const chat = async (id, messages, cb) => {
  const session = sessions[id];
  session.isPlaying = true;
  resetAfterRecording(session);

  // Set up text-to-speech streaming
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice: session.voice });
  (async () => {
    for await (const { text, phonemes, audio } of stream) {
      cb({ text, audio });
    }
  })();

  // 2. Generate a response using the LLM
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      splitter.push(text);
    },
    token_callback_function: () => {},
  });

  session.stopping_criteria = new InterruptableStoppingCriteria();
  const { past_key_values, sequences } = await llm.generate({
    ...inputs,
    past_key_values: session.past_key_values_cache,

    do_sample: false, // TODO: do_sample: true is bugged (invalid data location on topk sample)
    max_new_tokens: 1024,
    streamer,
    stopping_criteria: session.stopping_criteria,
    return_dict_in_generate: true,
  });
  session.past_key_values_cache = past_key_values;

  // Finally, close the stream to signal that no more text will be added.
  splitter.close();

  const decoded = tokenizer.batch_decode(sequences.slice(null, [inputs.input_ids.dims[1], null]), { skip_special_tokens: true });

  messages.push({ role: "assistant", content: decoded[0] });
  session.isPlaying = false;
};

function speak(id, text, cb) {
  const session = sessions[id];
  session.isPlaying = true;
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice: session.voice });
  (async () => {
    for await (const { text: chunkText, audio } of stream) {
      cb({ type: "output", text: chunkText, audio });
    }
  })();
  splitter.push(text);
  splitter.close();
  session.isPlaying = false;
}

export { transcribe };
export { chat };
export { speak };
export const interrupt = (id) => sessions[id].stopping_criteria?.interrupt();
