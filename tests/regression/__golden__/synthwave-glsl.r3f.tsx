import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

export const CustomShaderMaterial = shaderMaterial(
  { u_time: 0, u_resolution: new THREE.Vector2(), u_gridColor: new THREE.Color(0, 0.9, 1), u_sunColor: new THREE.Color(1, 0.1, 0.5), u_speed: 3.5 },
  /* vertex */ `
    varying vec3 v_world_pos;
    void main() {
      v_world_pos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  /* fragment */ `
    precision highp float;
    
    in vec3 v_world_pos;
    
    uniform float u_time;
    uniform vec3 u_gridColor;
    uniform vec3 u_sunColor;
    uniform float u_speed;
    
    // Plane coordinates in [-1, 1] with +y up (handles both XY and XZ plane meshes)
    vec2 planeUv(vec3 p) {
        float v = abs(p.z) > 0.0001 ? -p.z : p.y;
        return vec2(p.x, v);
    }
    
    void main() {
        vec2 uv = planeUv(v_world_pos);
        float horizon = -0.1;
    
        // Perspective ground projection (derivatives are taken outside any branch)
        float depth = 1.0 / max(horizon - uv.y, 0.001);
        vec2 gridUv = vec2(uv.x * depth, depth - u_time * u_speed);
        vec2 fw = max(fwidth(gridUv), vec2(0.0001));
        vec2 grid = abs(fract(gridUv - 0.5) - 0.5) / fw;
        float line = min(grid.x, grid.y);
        float gridIntensity = 1.0 - min(line, 1.0);
        float fog = exp(-depth * 0.15);
    
        vec3 finalColor = vec3(0.02, 0.01, 0.06);
    
        if (uv.y < horizon) {
            finalColor += u_gridColor * gridIntensity * fog;
        } else {
            // Sunset sky gradient
            float sky = (uv.y - horizon) / (1.0 - horizon);
            finalColor = mix(vec3(0.1, 0.0, 0.2), vec3(0.02, 0.0, 0.08), sky);
    
            // Glowing digital sun with horizontal blinds
            vec2 sunPos = vec2(0.0, 0.25);
            float sunDist = length(uv - sunPos);
            if (sunDist < 0.35) {
                float blinds = sin(uv.y * 50.0) * 0.5 + 0.5;
                float sunCut = smoothstep(0.2, 0.8, blinds);
                float sunGrad = (uv.y - (sunPos.y - 0.35)) / 0.7;
                vec3 sunC = mix(u_sunColor, vec3(1.0, 0.9, 0.2), sunGrad);
                finalColor = mix(finalColor, sunC, sunCut);
            }
    
            // Sun corona bloom
            finalColor += u_sunColor * (0.15 / (sunDist + 0.1));
        }
    
        gl_FragColor = vec4(finalColor, 1.0);
    }
  `
);

extend({ CustomShaderMaterial });

export const StorybookPreview = () => (
  <mesh>
    <planeGeometry args={[2, 2]} />
    <CustomShaderMaterial />
  </mesh>
);