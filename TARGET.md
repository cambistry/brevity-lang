actor FileRep

  use Edits, Heads, Blobs, Crypto

  ----------------
  // Public API //
  ----------------

  @apply_all_changes(:path : Text)

    :edits = Edits.fetch(:path)
    :blob_id, :dag_id = Heads.fetch(:path)

    -- get current contents --
    prev_blob = Blobs.fetch(:blob_id)["blob"]
    :contents = Crypto.unpack(blob: prev_blob)

    -- apply edits --
    contents =
      reduce(contents) edits (acc, edit) // iterating against a function: `(args) block`
        apply_change(contents: acc, :edit)[:contents]

    -- store new contents --
    new_blob = Crypto.pack(:contents)[:blob]
    new_blob_id = Blobs.store(blob: new_blob)[:blob_id]
    :status = Heads.new(:path, blob_id: new_blob_id, prev: :dag_id)

    reply :status

  -----------
  // PROCS //
  -----------

  proc apply_change(:contents : Text, :edit : EditStruct)
    // ... text manipulation ...
    reply :contents
