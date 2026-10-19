struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct DoFParams {
  focalDistance: f32,
  aperture: f32,
  maxBlur: f32,
  bokehShape: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: DoFParams;
@group(0) @binding(3) var u_depthTexture: texture_2d<f32>;

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

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let centerColor = textureSample(u_texture, u_sampler, texCoord);
  let depth = textureSample(u_depthTexture, u_sampler, texCoord).r;

  let near: f32 = 0.1;
  let far: f32 = 100.0;
  let zLinear = (near * far) / (far - depth * (far - near));

  let coc = clamp(abs(zLinear - params.focalDistance) / max(zLinear, 0.001) * params.aperture * 100.0, 0.0, params.maxBlur);
  if (coc < 0.5) {
    return centerColor;
  }

  var accum = vec4<f32>(0.0);
  var totalWeight: f32 = 0.0;
  let SAMPLES: i32 = 24;
  let texelSize = vec2<f32>(0.001, 0.001);

  for (var i = 0; i < SAMPLES; i = i + 1) {
    let theta = f32(i) * 2.3999632;
    var r = sqrt(f32(i + 1) / f32(SAMPLES)) * coc;

    if (params.bokehShape > 0.5) {
      let n: f32 = select(6.0, 8.0, params.bokehShape > 1.5);
      let piN: f32 = 3.14159265 / n;
      let modAngle = ((theta % (2.0 * piN)) + 2.0 * piN) % (2.0 * piN) - piN;
      r = r * (cos(piN) / cos(modAngle));
    }

    let offset = vec2<f32>(cos(theta), sin(theta)) * r * texelSize;
    let sampleCol = textureSample(u_texture, u_sampler, texCoord + offset);
    let lum = dot(sampleCol.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let weight = 1.0 + pow(max(0.0, lum - 0.7), 2.0) * 4.0;

    accum = accum + sampleCol * weight;
    totalWeight = totalWeight + weight;
  }

  return accum / max(totalWeight, 0.001);
}
