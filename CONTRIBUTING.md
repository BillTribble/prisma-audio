# Contributing directly to Prismata

We welcome new Crystal extractions!

## How to Add a Model

1.  **Generate the Crystal**
    Use the python script to extract weights or activations.
    ```bash
    python scripts/prismata_make.py facebook/opt-125m --mode layers
    ```

2.  **Organize Files**
    *   Create a folder: `public/crystals/opt125m/`
    *   Move your `.ply` files there.
    *   Create `INFO.md` (Short description for sidebar/UI).
    *   Create `README.md` (Full architectural deep-dive).

3.  **Update Manifest**
    Open `public/crystals/manifest.json` and add your entry:
    ```json
    {
      "id": "opt125m",
      "name": "OPT-125M",
      "type": "Decoder",
      "desc": "Open Pre-trained Transformer...",
      "crystals": [
        { "id": "struct", "name": "Structure", "file": "crystals/opt125m/structure.ply", "desc": "..." }
      ]
    }
    ```

4.  **Submit PR**
    Push your changes and open a Pull Request!
