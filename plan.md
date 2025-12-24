# Task Plan: Add Target FPS Control

## Overview
Add a configurable target FPS slider in the advanced controls section, modify the Dynamic Performance Governor to use this target instead of hardcoded 30, and ensure it applies to both viewers.

## Steps

### 1. Add State Variable
- Add `let targetFPS = 30;` to the state variables in src/ui.js

### 2. Add Target FPS Slider Control
- In `setupControls()`, after the auto FPS toggle, create a new control group for the target FPS slider
- Create a div with class 'control-group'
- Inner HTML: label "Target FPS" and input type="range" id="target-fps-slider" min="10" max="120" value="30" step="1"
- Append to advancedSection
- Add event listener to update targetFPS on input

### 3. Modify Dynamic Performance Governor
- In the 'fps-update' event listener, change the condition from `fps < 30` to `fps < targetFPS`
- Change the recovery condition from `fps >= 31` to `fps >= targetFPS + 1`
- Update the console log to include the target FPS

### 4. Ensure Application to Both Viewers
- Verify that the governor applies changes to both mainViewer and compareViewer (already does via forEach loop)

## Completion
- All changes made to src/ui.js
- Slider allows setting target FPS from 10 to 120
- Governor adjusts performance based on target FPS when auto FPS is enabled