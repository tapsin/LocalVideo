# LocalVideo

LocalVideo turns a written video idea into a scene plan and an MP4 video from a small, local-first interface. It is designed for creators who want to describe a video in Turkish, refine an English production plan, and choose where the actual video is generated. The scene-planning model and video-generation provider are independent settings: for example, you can plan locally with Ollama and render with a cloud video API, or use an API to plan and generate with local Wan.

The application runs its web interface and Node.js service on the same computer and binds the service to `127.0.0.1`. It is a local web application launched from a terminal; this repository does not currently package a native desktop installer.

## What it does

### 1. Turn a prompt into an English scene plan

Enter a brief in Turkish (or another language) and ask a scene-planning model to produce an English title and ordered scene descriptions. The plan includes a heading, action description, visual direction and accent color for each scene. The prompt instructs the model to preserve the details in the brief and avoid adding new story elements. You can review and edit the generated plan before rendering.

Choose one of two planning modes:

- **Ollama (local):** select a model already installed in Ollama. On first launch the setup script checks for Ollama and downloads `qwen3.5:2b` if it is missing.
- **OpenAI-compatible API:** enter the endpoint, model name and API key for a compatible chat-completions service. The key is used for the request and is not written to an application settings file.

Language models can misunderstand a brief or return incomplete output. Review the English scene plan before sending it to a video provider.

### 2. Choose how to create the video

The video-generation choice is separate from the planning choice:

- **Local Wan 2.1:** uses ComfyUI on this computer to generate video scenes. The launcher checks or installs ComfyUI, its Python dependencies, the required Wan 2.1 model weights and FFmpeg. The app submits the English scene prompts to the local ComfyUI service and combines the resulting clips into one MP4.
- **Google Veo API:** sends scene prompts to Google's video-generation API, downloads the returned clips and combines them locally.
- **Higgsfield API:** sends scene prompts to the configured Higgsfield model, downloads the returned clips and combines them locally.

Cloud video modes require a provider account, an API key and network access. The app displays a confirmation before sending prompts to a cloud provider because the service may consume paid credits. Provider access, model availability, supported aspect ratios and resolution options are controlled by the provider and may change.

### 3. Make a designed video from the scene plan

The **graphic video** action uses Remotion to render a designed, animated video from the scene plan. It supports the selected output dimensions (including common landscape, portrait and square formats) and exports MP4. This is a motion-graphics presentation of the plan; it does not create photorealistic AI footage. Use the separate AI video action for generated video scenes.

Completed MP4 files are saved in the project's `renders/` directory. Intermediate downloads and clips are stored under `work/` while a job runs.

## Quick start on Linux

### Requirements

- 64-bit Linux. The launcher includes download paths for x86_64 and ARM64 for some utilities; GPU video generation and ComfyUI compatibility depend on the hardware and installed drivers.
- Bash, Git, curl, Python 3 with `venv`, Node.js/npm, and a desktop browser. `ffmpeg` and Ollama may already be installed or are checked by the launcher.
- Internet access for the initial setup. The app downloads runtime components and large model files. Allow roughly 20 GB of free disk space as an initial planning estimate; actual use varies with installed packages, model files and generated videos.
- For local Wan generation, a supported NVIDIA GPU and compatible drivers are strongly recommended. Memory needs and generation speed vary. The interface's earlier machine-specific timing is only an estimate, not a performance guarantee.

### Install and launch

```bash
git clone https://github.com/tapsin/LocalVideo.git
cd LocalVideo
chmod +x start.sh
./start.sh
```

On the first run, `start.sh` checks for and, when needed, downloads or installs:

- ComfyUI and its Python environment/dependencies;
- Wan 2.1 video, text-encoder and VAE weights (about 9.8 GB in total, subject to upstream changes);
- Ollama and the default `qwen3.5:2b` planning model if not already available;
- FFmpeg if it is not available on `PATH`;
- the pinned Remotion/React dependencies and Remotion's headless browser runtime.

Later launches reuse the files they find. Installation requires internet access and writes runtime/model files to the project folder or configured ComfyUI location. Do not launch the script from a read-only folder. Review the upstream licenses and terms for each third-party runtime and model before use.

When the local service starts, it opens `http://127.0.0.1:4177` in a browser. Stop it with `Ctrl+C` in the terminal. The app is bound to loopback and is intended for use on the same computer.

### Optional service paths

The launcher uses these defaults and accepts environment-variable overrides:

```bash
COMFY_ROOT="$HOME/ComfyUI-Installs/ComfyUI/ComfyUI" ./start.sh
OLLAMA_URL="http://127.0.0.1:11434" ./start.sh
OPENMONTAGE_DIR="$HOME/Projeler/OpenMontage" ./start.sh
```

`PORT` changes the local web port. `WAN_STEPS` and `WAN_FRAMES` can adjust the local Wan workflow; defaults are selected in `server.mjs`. Changing these can affect output quality, memory use and render time.

## Resolution, duration and output limits

- Scene count is derived from the selected duration; local Wan uses five-second scenes. The app currently accepts AI-video durations from 15 to 90 seconds.
- The current local Wan workflow renders at **832 × 480** and produces silent clips. The graphic-render resolution selector does not upscale or change local Wan footage.
- Google Veo uses provider-generated clips (currently requested as eight-second segments) that are cut and joined to the selected duration. Higgsfield uses five-second scene requests in the current integration. Provider contracts can change.
- Clips are requested separately and then concatenated. Character identity, exact visual continuity, audio, transitions and precise duration can vary by model/provider. The local Wan workflow strips audio when assembling clips.
- Real-ESRGAN, anything2explainer and OpenMontage are not part of the current generation pipeline. They are not automatically installed. The status panel may detect some optional local components, but their detection does not mean the app uses them.

## Privacy and network behavior

Local scene planning and local Wan generation can keep prompts and generated scenes on the computer after setup. Initial installation still downloads code, model weights and browser/runtime files from their upstream hosts.

When an API planning or video provider is selected, the relevant prompt and scene text are sent to that provider. API credentials are accepted for an individual request and are not intentionally saved in a settings file. As with any local application, review the source code and protect your operating-system account and any terminal/session data.

The web server listens only on `127.0.0.1`; do not change this binding or expose the port to a network unless you have added appropriate authentication and access controls.

## Troubleshooting

- **The page does not open:** check the terminal for setup errors, then visit `http://127.0.0.1:4177` manually.
- **Ollama has no model:** check that its local service is reachable and wait for the first model download to finish. You can also select an OpenAI-compatible planning API.
- **Wan is unavailable:** confirm ComfyUI dependencies and weights finished installing, check that the GPU driver works, and read the ComfyUI output in the terminal/log. Large models can take time to load.
- **The render is slow or runs out of memory:** lower the Wan step/frame environment settings, close other GPU workloads or use a provider whose requirements fit your setup. Reduced settings may lower quality.
- **A cloud request fails:** verify the provider key, account access, model identifier, supported region, quota and current API contract. LocalVideo cannot grant provider access or bypass provider limits.

## Project status

This is an actively developed, Linux-first local application. The local Wan path is tied to upstream ComfyUI and model compatibility; cloud integrations depend on third-party APIs. The startup routine can install substantial dependencies on first launch, so inspect `start.sh` and the upstream component documentation before running it on a machine where you do not want software or large model files installed.

## License

The LocalVideo application source is distributed under the MIT License. Third-party models, runtimes and services are governed by their own licenses and terms.

## DONATE

USDT TRC20 | `TYCK6ZyMS6UDt787foPH2QwFuvkdqMw1Jv`

USDT BSC20 | `0x15aac92a1945ddbe5c79304bfa388d6be99b26a3`

Created by **TAPSIN**
