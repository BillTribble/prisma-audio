import * as CANNON from 'cannon-es';

export class PhysicsWorld {
    constructor(length = 50, count = 20) {
        this.world = new CANNON.World();
        this.world.gravity.set(0, 0, 0); // No gravity, floating in soup
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.solver.iterations = 10;

        this.bodies = [];
        this.springs = []; // Store springs here
        this.length = length;
        this.count = count;
        this.stepSize = length / (count - 1);

        this.initSpine();

        // Arrays for export to shader
        this.spinePositions = new Float32Array(count * 3);
    }

    initSpine() {
        let prevBody = null;
        const halfLen = this.length / 2;

        for (let i = 0; i < this.count; i++) {
            const x = i * this.stepSize - halfLen; // Center the spine
            const radius = 0.5;

            const shape = new CANNON.Sphere(radius);
            // Anchor both ends to keep it centered and stretched
            const mass = (i === 0 || i === this.count - 1) ? 0 : 1;

            const body = new CANNON.Body({
                mass: mass,
                position: new CANNON.Vec3(x, 0, 0),
                linearDamping: 0.5,
                angularDamping: 0.5
            });

            body.addShape(shape);
            this.world.addBody(body);
            this.bodies.push(body);

            if (prevBody) {
                const spring = new CANNON.Spring(prevBody, body, {
                    localAnchorA: new CANNON.Vec3(0, 0, 0),
                    localAnchorB: new CANNON.Vec3(0, 0, 0),
                    restLength: this.stepSize,
                    stiffness: 100, // Increased stiffness
                    damping: 4,     // Increased damping for smoother snake
                });
                this.springs.push(spring);
            }

            prevBody = body;
        }
    }

    update(dt) {
        // Apply spring forces manually
        this.springs.forEach(spring => spring.applyForce());

        // Fixed time step for stability
        this.world.step(1 / 60, dt, 3);

        // Sync data arrays
        for (let i = 0; i < this.count; i++) {
            const b = this.bodies[i];
            this.spinePositions[i * 3 + 0] = b.position.x;
            this.spinePositions[i * 3 + 1] = b.position.y;
            this.spinePositions[i * 3 + 2] = b.position.z;
        }
    }

    applyAudioForce(audioLevel, playX) {
        // Find body closest to playX
        const halfLen = this.length / 2;
        const normalizedX = playX + halfLen; // Map -25..25 to 0..50

        let idx = Math.floor(normalizedX / this.stepSize);
        idx = Math.max(0, Math.min(this.count - 1, idx));

        const body = this.bodies[idx];
        if (!body || body.mass === 0) return;

        // Apply much stronger force
        const forceMag = audioLevel * 500.0; // Increased from 150

        // Random direction for "organic" writhe
        const rX = (Math.random() - 0.5) * 0.2;
        const rY = (Math.random() - 0.5);
        const rZ = (Math.random() - 0.5);

        const force = new CANNON.Vec3(rX, rY, rZ);
        force.normalize();
        force.scale(forceMag, force);

        body.applyForce(force, body.position);

        // Propagate more to neighbors
        for (let d = 1; d <= 2; d++) {
            const factor = 1.0 / (d + 1);
            if (idx - d >= 0) this.bodies[idx - d].applyForce(force.clone().scale(factor), this.bodies[idx - d].position);
            if (idx + d < this.count) this.bodies[idx + d].applyForce(force.clone().scale(factor), this.bodies[idx + d].position);
        }
    }
}
