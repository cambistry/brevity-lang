Serialize actors for spin down and spin up, initially to in order to enable `clone`, but ultimately to enable stateful processes to persist through restart and dealloc realloc.

Not necessarily a direct language construct -- these tools are for process lifecycle manangement by the host kernel.

Any *stateful* Brevity object that needs persistence should be able to repond to a CAM message to recursively capture state. Something like:

{
  "id": "123",
  "cam": "capture",
  "from": "<supervisor>"
}

