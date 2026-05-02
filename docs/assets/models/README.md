# Model Assets

This directory is reserved for canonical mesh-import reference assets.

## Suzanne Status

`suzanne.obj` and `suzanne_low.obj` are not committed yet because this pass did not find a clearly redistributable CC0 OBJ source for Blender's Suzanne mesh. The commonly indexed Wikimedia Suzanne export identifies the model as GPLv3-or-later, which is not safe to add here without an explicit project decision to accept GPL model assets.

Source notes checked:

- Wikimedia Commons `File:Suzanne.stl`: GPLv3-or-later file license, https://commons.wikimedia.org/wiki/File:Suzanne.stl.
- Blender Open Data download page: CC0 applies to the Open Data archive, but no Suzanne OBJ source was identified there during this pass, https://opendata.blender.org/download/.

## Sponza Status

`sponza/sponza.glb` is also not committed in this scaffold pass. The intended source is the Khronos glTF Sample Assets Intel Sponza GLB, which is listed as CC-BY 4.0 and should keep its attribution text beside the asset when it is added. Defer the large binary download until mesh rendering and texture atlas integration are ready to consume it.

Source notes checked:

- Khronos glTF Sample Assets repository: Intel Sponza entry and license metadata, https://github.com/KhronosGroup/glTF-Sample-Assets.
