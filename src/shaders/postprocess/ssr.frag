#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_envMap;
uniform mat4 u_invProj;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_invView;
uniform vec2 u_resolution;
uniform float u_maxSteps;
uniform float u_thickness;
uniform float u_falloff;
uniform float u_iblBlend;

in vec2 v_texCoord;
out vec4 fragColor;

vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = u_invProj * clip;
  return view.xyz / view.w;
}

vec2 projectViewPos(vec3 viewPos) {
  vec4 clip = u_proj * vec4(viewPos, 1.0);
  vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
  return uv;
}

void main() {
  vec4 baseColor = texture(u_texture, v_texCoord);
  float depth = texture(u_depthTexture, v_texCoord).r;
  if (depth >= 1.0) {
    fragColor = baseColor;
    return;
  }

  vec4 normRough = texture(u_normalTexture, v_texCoord);
  vec3 worldNormal = normalize(normRough.xyz * 2.0 - 1.0);
  vec3 viewNormal = normalize((u_view * vec4(worldNormal, 0.0)).xyz);
  float roughness = normRough.a;

  if (roughness > 0.6) {
    fragColor = baseColor;
    return;
  }

  vec3 viewPos = reconstructViewPos(v_texCoord, depth);
  vec3 viewDir = normalize(viewPos);
  vec3 reflectDir = normalize(reflect(viewDir, viewNormal));

  int maxSteps = int(clamp(u_maxSteps, 16.0, 128.0));
  float stepSize = 0.1;
  vec3 rayPos = viewPos + reflectDir * 0.05;

  bool hit = false;
  vec2 hitUV = vec2(0.0);

  for (int i = 0; i < maxSteps; i++) {
    rayPos += reflectDir * stepSize;
    vec2 sampleUV = projectViewPos(rayPos);

    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
      break;
    }

    float sampleDepth = texture(u_depthTexture, sampleUV).r;
    vec3 sampleViewPos = reconstructViewPos(sampleUV, sampleDepth);

    float depthDiff = rayPos.z - sampleViewPos.z;
    if (depthDiff > 0.0 && depthDiff < u_thickness) {
      vec3 refinePos = rayPos - reflectDir * stepSize;
      vec3 halfStep = reflectDir * (stepSize * 0.5);
      for (int b = 0; b < 4; b++) {
        refinePos += halfStep;
        vec2 refUV = projectViewPos(refinePos);
        float refDepth = texture(u_depthTexture, refUV).r;
        vec3 refViewPos = reconstructViewPos(refUV, refDepth);
        if (refinePos.z > refViewPos.z) {
          refinePos -= halfStep;
        }
        halfStep *= 0.5;
      }
      hitUV = projectViewPos(refinePos);
      hit = true;
      break;
    }
    stepSize *= 1.02;
  }

  if (hit) {
    vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.1), hitUV) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - hitUV);
    float vignette = edgeFade.x * edgeFade.y;
    float confidence = pow(vignette, u_falloff) * (1.0 - roughness / 0.6);

    vec4 reflectedColor = texture(u_texture, hitUV);
    vec3 blended = mix(baseColor.rgb, reflectedColor.rgb, confidence * (1.0 - u_iblBlend));
    fragColor = vec4(blended, baseColor.a);
  } else {
    fragColor = baseColor;
  }
}
