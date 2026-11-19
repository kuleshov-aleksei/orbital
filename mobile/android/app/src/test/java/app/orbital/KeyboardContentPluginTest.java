package app.orbital;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import org.junit.Test;

public class KeyboardContentPluginTest {

    @Test
    public void copyBoundedPreservesGifBytes() throws Exception {
        byte[] gif = new byte[] { 'G', 'I', 'F', '8', '9', 'a' };
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        long size = KeyboardContentPlugin.copyBounded(
                new ByteArrayInputStream(gif), output, gif.length);

        assertEquals(gif.length, size);
        assertArrayEquals(gif, output.toByteArray());
    }

    @Test
    public void copyBoundedRejectsInsteadOfTruncating() {
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        assertThrows(KeyboardContentPlugin.TooLargeException.class, () ->
                KeyboardContentPlugin.copyBounded(
                        new ByteArrayInputStream(new byte[] { 1, 2, 3, 4, 5 }), output, 4));
        assertEquals(0, output.size());
    }
}
