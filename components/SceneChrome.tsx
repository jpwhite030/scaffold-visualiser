'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Grid, Environment, SoftShadows, ContactShadows } from '@react-three/drei';

/**
 * All the non-content scene setup shared by the building and site viewers:
 * gradient backdrop, fog, lights, opaque ground, reference grid, contact
 * shadows and environment. Tuned once — keep both viewers pixel-identical.
 */
export default function SceneChrome({ groundSpread, shadowFar }: {
  groundSpread: number;   // ContactShadows plane scale
  shadowFar: number;      // ContactShadows falloff (roughly max eave + margin)
}) {
  return (
    <>
      {/* Light studio backdrop — scaffold renders read like the sales decks
          (pale sky, near-white ground) instead of a night scene. */}
      <GradientBackground top="#dce6f0" bottom="#f5f7f9" />

      {/* Gentle distance fog (matched to the backdrop's lower tone) so the
          ground and far grid melt into the horizon instead of ending hard. */}
      <fog attach="fog" args={['#f0f3f6', 90, 300]} />

      {/* Soft, penumbra shadows for a realistic rendered look */}
      <SoftShadows size={26} samples={16} focus={0.9} />

      <ambientLight intensity={0.5} />
      {/* Warm key light */}
      <directionalLight position={[20, 28, 16]} intensity={2.4} color="#fff6e8" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-far={140}
        shadow-camera-left={-40} shadow-camera-right={40}
        shadow-camera-top={40} shadow-camera-bottom={-40} />
      {/* Cool fill from the opposite side to lift the shadows */}
      <directionalLight position={[-18, 12, -14]} intensity={0.5} color="#dfe9fb" />
      <hemisphereLight args={['#eaf2fc', '#b8bcc2', 0.6]} />

      {/* Opaque ground so the scaffold sits on a real surface instead of
          floating over a void — it receives the soft directional shadow
          directly, giving proper contact shadows under the structure. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#e9ebee" roughness={0.96} metalness={0} />
      </mesh>

      {/* Faint site grid laid just over the ground for scale reference — no
          longer the dominant element now there's a real ground beneath it. */}
      <Grid args={[80, 80]} position={[0, 0.012, 0]} cellColor="#d5dae0" sectionColor="#bcc4cd"
        fadeDistance={55} fadeStrength={2} infiniteGrid />

      {/* Soft ambient-occlusion shadow directly under the structure (baked
          once — the scene is static), on top of the directional sun shadow. */}
      <ContactShadows position={[0, 0.02, 0]} scale={groundSpread} resolution={1024}
        blur={2.6} opacity={0.38} far={shadowFar} frames={1} color="#5a616c" />

      <Environment preset="city" />
    </>
  );
}

// Paints a smooth vertical gradient as the scene background using a canvas
// texture — deterministic top→bottom colours, no orientation guesswork.
function GradientBackground({ top, bottom }: { top: string; bottom: string }) {
  const { scene } = useThree();
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene, top, bottom]);
  return null;
}

export function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${active ? 'bg-white text-gray-900 shadow' : 'bg-black/50 text-gray-400 hover:bg-black/70'}`}>
      {label}
    </button>
  );
}
