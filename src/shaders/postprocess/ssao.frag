#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform sampler2D u_normalTexture;
uniform vec2 u_resolution;
uniform float u_radius;
uniform float u_intensity;
uniform float u_sampleCount;
uniform float u_bias;

in vec2 v_texCoord;
out vec4 fragColor;

float interleavedGradientNoise(vec2 screenPos) {
  return fract(52.9829189 * fract(dot(screenPos, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 baseColor = texture(u_texture, v_texCoord);
  float depth = texture(u_depthTexture, v_texCoord).r;
  if (depth >= 1.0) {
    fragColor = baseColor;
    return;
  }

  vec3 normal = texture(u_normalTexture, v_texCoord).xyz;
  normal = normalize(normal * 2.0 - 1.0);

  vec2 uv = v_texCoord;
  vec2 screenPos = uv * u_resolution;
  float noise = interleavedGradientNoise(screenPos);
  float angle = noise * 6.2831853;

  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  float occlusion = 0.0;
  int samples = int(clamp(u_sampleCount, 4.0, 32.0));
  float radius = u_radius * 0.05;

  for (int i = 0; i < samples; i++) {
    float fi = float(i) / float(samples);
    float sampleAngle = fi * 6.2831853 * 2.0;
    float dist = sqrt(fi) * radius;
    vec2 offset = rot * vec2(cos(sampleAngle), sin(sampleAngle)) * dist;
    vec2 sampleUV = clamp(uv + offset, vec2(0.0), vec2(1.0));

    float sampleDepth = texture(u_depthTexture, sampleUV).r;
    float depthDiff = (depth - sampleDepth);
    if (depthDiff > u_bias && depthDiff < radius * 4.0) {
      float distFalloff = 1.0 - smoothstep(0.0, radius * 4.0, depthDiff);
      occlusion += distFalloff;
    }
  }

  float ao = clamp(1.0 - (occlusion / float(samples)) * u_intensity, 0.0, 1.0);
  fragColor = vec4(baseColor.rgb * ao, baseColor.a);
}
