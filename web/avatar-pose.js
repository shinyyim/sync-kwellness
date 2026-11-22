/* A front-facing portrait on a deformable depth mesh. UVs use top-left origin. */
function doonaVertex(u, v, time, gaze, activity, look) {
  const tau = Math.PI * 2;
  const phase = time * tau / 4;
  const wave = Math.sin(phase);
  const weight = (cx, cy, wx, wy) => Math.exp(-(((u-cx)/wx)**2 + ((v-cy)/wy)**2));
  const head = weight(.53,.21,.29,.25);
  const body = weight(.50,.52,.32,.72);
  const depth = .10*body + .13*head + .028*weight(.54,.23,.10,.10);
  const yaw = wave*.055 + gaze*.23;
  const lean = (.026*wave + .013*activity*Math.sin(phase*2))*head;
  const hand = look === 'signature' ? weight(.27,.38,.15,.20) : 0;
  const lift = (1-Math.cos(phase))*.5;
  const x = (u-.5)*Math.cos(yaw) + depth*Math.sin(yaw) - lean*(v-.43)
    + body*.006*wave + hand*.018*lift;
  const y = v-.5 + lean*(u-.50) - body*.009*lift - hand*(.026+.015*activity)*lift;
  const scale = 1 / (1 - .18 * (depth*Math.cos(yaw) - (u-.50)*Math.sin(yaw)));
  return [.5 + x*scale*.94, .5 + y*scale*.94];
}
