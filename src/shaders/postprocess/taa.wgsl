struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct TAAParams {
  feedbackMin: f32,
  feedbackMax: f32,
  motionScale: f32,
  padding: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TAAParams;
@group(0) @binding(3) var u_historyTexture: texture_2d<f32>;
@group(0) @binding(4) var u_motionTexture: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.texCoord = pos[vertexIndex] * 0.5 + 0.5;
  out.texCoord.y = 1.0 - out.texCoord.y;
  return out;
}

fn RGBToYCoCg(rgb: vec3<f32>) -> vec3<f32> {
  let Y  = dot(rgb, vec3<f32>( 0.25, 0.50,  0.25));
  let Co = dot(rgb, vec3<f32>( 0.50, 0.00, -0.50));
  let Cg = dot(rgb, vec3<f32>(-0.25, 0.50, -0.25));
  return vec3<f32>(Y, Co, Cg);
}

fn YCoCgToRGB(ycocg: vec3<f32>) -> vec3<f32> {
  let Y  = ycocg.x;
  let Co = ycocg.y;
  let Cg = ycocg.z;
  let R = Y + Co - Cg;
  let G = Y + Cg;
  let B = Y - Co - Cg;
  return vec3<f32>(R, G, B);
}

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let texelSize = vec2<f32>(1.0 / 800.0, 1.0 / 600.0);
  let currentColor = textureSample(u_texture, u_sampler, texCoord);
  let motion = textureSample(u_motionTexture, u_sampler, texCoord).xy * params.motionScale;
  let historyUV = texCoord - motion;
  let historyColor = textureSample(u_historyTexture, u_sampler, historyUV);

  var minColor = RGBToYCoCg(currentColor.rgb);
  var maxColor = minColor;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
      let neighbor = RGBToYCoCg(textureSample(u_texture, u_sampler, texCoord + offset).rgb);
      minColor = min(minColor, neighbor);
      maxColor = max(maxColor, neighbor);
    }
  }

  let historyYCoCg = clamp(RGBToYCoCg(historyColor.rgb), minColor, maxColor);
  let clampedHistory = YCoCgToRGB(historyYCoCg);

  var blendWeight = clamp(params.feedbackMax, 0.8, 0.98);
  if (!(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)) {
    blendWeight = 0.0;
  }

  let finalColor = mix(currentColor.rgb, clampedHistory, blendWeight);
  return vec4<f32>(finalColor, currentColor.a);
}
