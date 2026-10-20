import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

export const CustomShaderMaterial = shaderMaterial(
  { u_time: 0, u_resolution: new THREE.Vector2(), pulseSpeed: 1.5, fresnelPower: 3, iridescence: 0.8, color: new THREE.Color(0.4, 0.6, 0.9), roughness: 0.35, u_audio_bass: 0, u_audio_mid: 0, u_audio_treble: 0, u_audio_beat: 0 },
  /* vertex */ `
    varying vec3 v_world_pos;
    varying vec2 v_uv;
    void main() {
      v_world_pos = position;
      v_uv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  /* fragment */ `
    precision highp float;
    precision highp int;
    
    struct VertexInput {
        vec3 position;
    };
    struct VertexOutput {
        vec4 clip_position;
        vec3 world_pos;
        vec2 uv;
    };
    uniform float u_time;
    uniform float pulseSpeed;
    uniform float fresnelPower;
    uniform float iridescence;
    uniform vec3 color;
    uniform float roughness;
    uniform float u_audio_bass;
    uniform float u_audio_mid;
    uniform float u_audio_treble;
    uniform float u_audio_beat;
    
    smooth in vec3 v_world_pos;
    smooth in vec2 v_uv;
    
    vec3 palette(float t) {
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.0, 0.33, 0.67);
        return (a + (b * cos((6.28318 * ((c * t) + d)))));
    }
    
    void main() {
        VertexOutput input_1 = VertexOutput(gl_FragCoord, v_world_pos, v_uv);
        vec3 normal = vec3(0.0);
        vec3 dX = dFdx(input_1.world_pos);
        vec3 dY = dFdy(input_1.world_pos);
        vec3 crossNorm = cross(dX, dY);
        normal = ((length(crossNorm) > 1e-5) ? normalize(crossNorm) : vec3(0.0, 1.0, 0.0));
        vec3 viewDir = normalize((vec3(0.0, 2.0, 4.0) - input_1.world_pos));
        vec3 _e23 = normal;
        if ((dot(_e23, viewDir) < 0.0)) {
            vec3 _e27 = normal;
            normal = -(_e27);
        }
        vec3 lightDir = normalize(vec3(1.0, 2.0, 1.5));
        vec3 halfVec = normalize((lightDir + viewDir));
        vec3 _e36 = normal;
        float NdotV = clamp(dot(_e36, viewDir), 0.0, 1.0);
        float _e49 = fresnelPower;
        float fresnel = pow(clamp((1.0 - NdotV), 0.0, 1.0), max(0.1, _e49));
        vec3 _e52 = normal;
        float NdotH = clamp(dot(_e52, halfVec), 0.0, 1.0);
        float _e61 = roughness;
        float shininess = mix(128.0, 8.0, clamp(_e61, 0.0, 1.0));
        float spec = pow(NdotH, shininess);
        float _e69 = u_time;
        float _e72 = pulseSpeed;
        float wavePhase = (((_e69 * _e72) * 0.5) + (input_1.world_pos.y * 2.0));
        float _e94 = u_audio_mid;
        float thinFilm = ((pow(clamp((1.0 - NdotV), 0.0, 1.0), 2.0) + (sin(wavePhase) * 0.15)) + (_e94 * 0.3));
        float _e100 = iridescence;
        vec3 _e102 = palette((thinFilm * _e100));
        vec3 _e104 = normal;
        float diff = max(0.25, ((dot(_e104, lightDir) * 0.55) + 0.45));
        vec3 _e113 = color;
        vec3 base = (_e113 * diff);
        float _e117 = u_audio_beat;
        float audioBoost = (1.0 + (_e117 * 0.5));
        vec3 rgb = (((mix(base, _e102, 0.65) + vec3((spec * 1.8))) + ((_e102 * fresnel) * 1.6)) * audioBoost);
        gl_FragColor = vec4(rgb, 1.0);
        return;
    }
    
  `
);

extend({ CustomShaderMaterial });

export const StorybookPreview = () => (
  <mesh>
    <torusKnotGeometry args={[0.8, 0.25, 100, 16]} />
    <CustomShaderMaterial />
  </mesh>
);