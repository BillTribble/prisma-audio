# ResNet-50 Crystal Collection

**Architecture:** Convolutional Neural Network (CNN)  
**Shape:** The "Inverted Pyramid"  
**Concept:** Feature Expansion (Pixels to Concepts)

ResNet-50 is a classic Vision model. Unlike Transformers which maintain a constant "hidden size", CNNs drastically change shape as they process data. They start with high spatial resolution (pixels) and few channels, and compress down to low spatial resolution but massive channel depth (2048 features). This creates a distinct inverted pyramid or "Christmas Tree" shape.

## Visualizations

### 1. Structural Crystals
*   **`structure_layers.ply`**: Displays the hierarchy of the 50 layers.
    *   **Bottom**: Narrow (64 filters), looking at edges/colors.
    *   **Middle**: Medium width (512 filters), looking at textures/parts.
    *   **Top**: Massive width (2048 filters), looking at complex objects.

### 2. Cognitive Heatmaps (Activations)
*   **`activation_cat.ply`**: *Input: "cat.jpg"*  
    A visual MRI of the network recognizing a cat.
    *   **Chaos at the bottom**: The intense red storm at the base represents the network processing the raw pixel "noise" of fur and whiskers.
    *   **Clarity at the top**: The distinct, isolated bright nodes at the summit represent the specific "Cat Neurons" firing to confirm the classification.
