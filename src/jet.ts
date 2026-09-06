import * as THREE from "three";

/* The player's jet — stylized fighter with glass canopy, swept wings, blinking
   nav lights and twin afterburners. Nose points -z (flying away from camera). */

export interface Jet {
  group: THREE.Group;
  navL: THREE.MeshStandardMaterial;
  navR: THREE.MeshStandardMaterial;
  burnL: THREE.MeshStandardMaterial;
  burnR: THREE.MeshStandardMaterial;
}

export function buildJet(): Jet {
  const g = new THREE.Group();
  const metal = { metalness: 0.8, roughness: 0.25 };

  const body = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, ...metal, emissive: 0x1a4a6e, emissiveIntensity: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb98cff, ...metal, emissive: 0x5a2ba8, emissiveIntensity: 0.55 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.85, 8, 20), body);
  fuselage.rotation.x = Math.PI / 2;
  g.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.128, 0.4, 20), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.62;
  g.add(nose);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0b1120, metalness: 0.2, roughness: 0.05, emissive: 0x9fefff, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), canopyMat);
  canopy.position.set(0, 0.11, -0.22);
  canopy.scale.set(0.85, 0.62, 1.7);
  g.add(canopy);

  const navL = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2b2b, emissiveIntensity: 2 });
  const navR = new THREE.MeshStandardMaterial({ color: 0x4dff88, emissive: 0x19ff6b, emissiveIntensity: 2 });
  for (const s of [-1, 1]) {
    const wingGroup = new THREE.Group();
    wingGroup.position.set(s * 0.1, -0.03, 0.1);
    wingGroup.rotation.set(0, -s * 0.55, s * 0.06);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.028, 0.34), accent);
    wing.position.x = s * 0.38;
    wingGroup.add(wing);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), s < 0 ? navL : navR);
    tip.position.set(s * 0.78, 0.015, 0);
    wingGroup.add(tip);
    g.add(wingGroup);

    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), accent);
    fin.position.set(s * 0.09, 0.15, 0.52);
    fin.rotation.z = s * 0.35;
    fin.scale.set(0.06, 1, 1);
    g.add(fin);
  }

  const engineMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, metalness: 0.9, roughness: 0.3 });
  const burnL = new THREE.MeshStandardMaterial({ color: 0xbfffec, emissive: 0x6bffd0, emissiveIntensity: 3 });
  const burnR = burnL.clone();
  [-1, 1].forEach((s, i) => {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.3, 14), engineMat);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 0.15, -0.05, 0.42);
    g.add(eng);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 10), i === 0 ? burnL : burnR);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.15, -0.05, 0.72);
    g.add(flame);
  });

  return { group: g, navL, navR, burnL, burnR };
}
