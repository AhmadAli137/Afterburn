import * as THREE from "three";

/* The view from the seat. What you see of your own aeroplane from inside is
   almost nothing: the canopy bow overhead, the coaming and glareshield below
   the glass, the HUD combiner standing up in front of you, and the canopy
   rails either side. All of it hangs off the camera, so it never moves in the
   frame — the world does. */

export interface Cockpit { group: THREE.Group; glass: THREE.MeshBasicMaterial; update(t: number, throttle: number): void }

export function buildCockpit(): Cockpit {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.85, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.6, metalness: 0.5 });

  // glareshield / coaming: a wide shallow wedge along the bottom of the view
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.5), dark);
  coaming.position.set(0, -0.4, -0.62); coaming.rotation.x = 0.3;
  g.add(coaming);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.02, 0.06), trim);
  lip.position.set(0, -0.315, -0.5); lip.rotation.x = 0.3;
  g.add(lip);

  // canopy bow: an arch across the top of the glass
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.014, 8, 48, Math.PI), trim);
  bow.position.set(0, -0.12, -0.7);
  g.add(bow);
  // rails down either side
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 1.2), trim);
    rail.position.set(s * 0.72, -0.22, -0.3); rail.rotation.x = -0.12;
    g.add(rail);
  }

  // the combiner: a faint tinted pane standing in front of the eye
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.018, depthWrite: false, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), glassMat);
  glass.position.set(0, -0.09, -0.5); glass.rotation.x = 0.06;
  g.add(glass);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.012), trim);
  frame.position.set(0, -0.19, -0.5);
  g.add(frame);

  // a few instrument glows on the coaming so the panel reads as a panel
  const lamps: THREE.Mesh[] = [];
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x7dffd9 });
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.012), i === 2 ? new THREE.MeshBasicMaterial({ color: 0xffb35c }) : lampMat);
    l.position.set(-0.24 + i * 0.12, -0.31, -0.38); l.rotation.x = -0.9;
    g.add(l); lamps.push(l);
  }
  g.visible = false;
  return {
    group: g, glass: glassMat,
    update(t, throttle) {
      // engine lamp breathes with the throttle
      (lamps[4].material as THREE.MeshBasicMaterial).color.setRGB(0.5 + throttle * 0.5, 1, 0.85);
      lamps[0].visible = Math.floor(t * 2) % 2 === 0;
    },
  };
}
